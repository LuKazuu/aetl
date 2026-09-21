// AETL - Backup / restore / zip helpers
'use strict';

async function compressZip(zip, mimeType, level = 9) {
  return await zip.generateAsync({
    type: 'blob', mimeType,
    compression: 'DEFLATE', compressionOptions: { level }
  });
}

async function addDirToZip(zip, dir, prefix, onProgress, label) {
  const queue = [['', dir]];
  let processed = 0;
  while (queue.length) {
    const [rel, cur] = queue.shift();
    for await (const [name, h] of cur.entries()) {
      const path = rel ? `${rel}/${name}` : name;
      const zipPath = prefix ? `${prefix}/${path}` : path;
      if (h.kind === 'directory') {
        zip.folder(zipPath);
        queue.push([path, h]);
      } else {
        zip.file(zipPath, await h.getFile());
        processed++;
      }
      if (onProgress && processed > 0 && processed % 20 === 0) {
        onProgress(`${label}: ${processed} files`, undefined);
        await yieldToEvent();
      }
    }
  }
}

async function buildProjectBackup(id, name, onProgress) {
  assertJsZip();
  const zip = new JSZip();
  zip.file('backup.json', JSON.stringify({ format: BACKUP_FORMAT_PROJECT, version: BACKUP_VERSION, originalId: id, originalName: name, createdAt: Date.now() }));
  onProgress('Reading project...', 30);
  const root = await Storage.root();
  const dir = await Storage._projectDir(root, id, false);
  await addDirToZip(zip, dir, 'project', onProgress, 'Backup');
  onProgress('Compressing backup...', 90);
  const blob = await compressZip(zip, 'application/octet-stream');
  return { blob, name: `${sanitizeName(name)}_backup.aetl`, warnings: [] };
}

async function backupAll(onProgress) {
  assertJsZip();
  const items = await Storage.listProjects();
  if (!items.length) throw new Error('No Projects to backup yet.');
  const total = items.length;
  const outer = new JSZip();
  outer.file('backup.json', JSON.stringify({ format: BACKUP_FORMAT_ALL, version: BACKUP_VERSION, createdAt: Date.now() }));
  const warnings = [];
  onProgress(`0 / ${total} project`, 0);
  const root = await Storage.root();

  onProgress('Backing up app data...', 5);
  try {
    const appDir = await root.getDirectoryHandle(APP_DIR);
    await addDirToZip(outer, appDir, 'app');
  } catch (e) { if (e?.name !== 'NotFoundError') warnings.push(`app/: ${e?.message || e}`); }

  onProgress('Backing up plugins...', 10);
  try {
    const pluginsDir = await root.getDirectoryHandle(PLUGINS_DIR);
    await addDirToZip(outer, pluginsDir, 'plugins');
  } catch (e) { if (e?.name !== 'NotFoundError') warnings.push(`plugins/: ${e?.message || e}`); }

  for (let i = 0; i < total; i++) {
    onProgress(`Processing ${i + 1} / ${total} project`, 10 + (i / total) * 85);
    try {
      const projectDir = await Storage._projectDir(root, items[i].id, false);
      await addDirToZip(outer, projectDir, `projects/${items[i].id}`, onProgress, `Project ${i + 1}/${total}`);
    } catch (e) {
      warnings.push(`${items[i].id || items[i].name}: ${e?.message || e}`);
    }
    onProgress(`${i + 1} / ${total} project done`, 10 + ((i + 1) / total) * 85);
    await yieldToEvent();
  }
  onProgress('Compressing main archive...', 98);
  const blob = await compressZip(outer, 'application/octet-stream');
  return { blob, name: `ProjectBackupAll_${new Date().toISOString().slice(0, 10)}.aetl`, warnings };
}

async function writeZipEntriesToDir(zip, prefix, dirHandle, onProgress, label) {
  const entries = Object.values(zip.files).filter(e => !e.dir && e.name.startsWith(prefix));
  let done = 0;
  for (const entry of entries) {
    const relPath = entry.name.slice(prefix.length);
    if (!relPath) continue;
    const parts = relPath.split('/');
    let cur = dirHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      cur = await cur.getDirectoryHandle(parts[i], { create: true });
    }
    const bytes = await entry.async('uint8array');
    await Storage._writeFile(cur, parts[parts.length - 1], bytes);
    done++;
    if (onProgress && done % 20 === 0) {
      onProgress(`${label}: ${done} files`, undefined);
      await yieldToEvent();
    }
  }
  return done;
}

async function writeProjectDirFromZip(zip, projectId, onProgress) {
  await Storage.createProjectDir(projectId);
  const root = await Storage.root();
  const projectDir = await Storage._projectDir(root, projectId, true);
  return writeZipEntriesToDir(zip, 'project/', projectDir, onProgress, 'Restoring');
}

async function writeAppDirFromZip(zip) {
  const root = await Storage.root();
  const appDir = await root.getDirectoryHandle(APP_DIR, { create: true });
  await writeZipEntriesToDir(zip, 'app/', appDir);
}

async function writePluginsDirFromZip(zip) {
  const root = await Storage.root();
  const pluginsDir = await root.getDirectoryHandle(PLUGINS_DIR, { create: true });
  await writeZipEntriesToDir(zip, 'plugins/', pluginsDir);
}

async function readBackupMeta(zip) {
  const f = zip.file('backup.json');
  if (!f) return null;
  return JSON.parse(await f.async('text'));
}

function validateBackupMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    throw new Error('Backup is missing or invalid metadata (backup.json).');
  }
  if (typeof meta.version !== 'number') {
    throw new Error('Backup has no version field.');
  }
  if (meta.version > BACKUP_VERSION) {
    throw new Error(`Backup format v${meta.version} is newer than this app supports (v${BACKUP_VERSION}). Update AETL and try again.`);
  }
  return meta;
}

async function restoreProjectFromZip(zip, fallbackName, onProgress) {
  const meta = validateBackupMeta(await readBackupMeta(zip));
  const projectJsonFile = zip.file('project/project.json');
  if (!projectJsonFile) throw new Error('Project file not found in backup.');
  const data = JSON.parse(await projectJsonFile.async('text'));
  if (!data.projectName) data.projectName = fallbackName || 'Restored Project';
  const newId = makeProjId();
  await writeProjectDirFromZip(zip, newId, onProgress);
  await Storage.upsertProjectIndexEntry(Storage.projectIndexEntry(newId, data, Date.now()));
  return data.projectName;
}

async function restoreAllFromZip(zip, onProgress) {
  const meta = validateBackupMeta(await readBackupMeta(zip));
  const projectPrefixes = new Set();
  for (const name of Object.keys(zip.files)) {
    if (name.startsWith('projects/')) {
      const parts = name.slice('projects/'.length).split('/');
      if (parts.length > 1) projectPrefixes.add(parts[0]);
    }
  }
  if (!projectPrefixes.size) throw new Error('No projects found in backup.');
  await writeAppDirFromZip(zip);
  await writePluginsDirFromZip(zip);
  const total = projectPrefixes.size;
  const errors = [];
  let ok = 0;
  let idx = 0;
  for (const projId of projectPrefixes) {
    idx++;
    onProgress(`Restoring ${idx} / ${total} project`, (idx / total) * 100);
    try {
      const projectJsonFile = zip.file(`projects/${projId}/project.json`);
      if (!projectJsonFile) { errors.push({ name: projId, message: 'project.json missing' }); continue; }
      const data = JSON.parse(await projectJsonFile.async('text'));
      const newId = makeProjId();
      await writeProjectDirFromZipById(zip, projId, newId);
      await Storage.upsertProjectIndexEntry(Storage.projectIndexEntry(newId, data, Date.now()));
      ok++;
    } catch (e) {
      errors.push({ name: projId, message: e?.message || String(e) });
    }
    await yieldToEvent();
  }
  return { single: false, ok, fail: errors.length, errors };
}

async function writeProjectDirFromZipById(zip, srcId, newId) {
  await Storage.createProjectDir(newId);
  const root = await Storage.root();
  const projectDir = await Storage._projectDir(root, newId, true);
  return writeZipEntriesToDir(zip, `projects/${srcId}/`, projectDir);
}

async function parseRestore(buffer, fallbackName, onProgress) {
  assertJsZip();
  const zip = new JSZip();
  await zip.loadAsync(buffer);

  if (zip.file('project/project.json')) {
    onProgress('Reading project...', 0);
    const name = await restoreProjectFromZip(zip, fallbackName, onProgress);
    onProgress('Saving project...', 100);
    return { single: true, name };
  }
  if (zip.file('backup.json')) {
    onProgress('Restoring full backup...', 0);
    return await restoreAllFromZip(zip, onProgress);
  }
  throw new Error('Invalid archive format.');
}
