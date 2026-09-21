// AETL - File import flow
'use strict';

const Importer = {
  assertProjectType(expected) {
    if (State.projectType !== 'uninitialized' && State.projectType !== expected) {
      App.flash(`This project is already set up as a ${State.projectType.toUpperCase()} project. Can't mix ${expected.toUpperCase()} files.`, true, 'error');
      return false;
    }
    if (State.projectType === 'uninitialized') State.projectType = expected;
    return true;
  },

  assertPluginProjectType(pluginMeta) {
    if (State.projectType !== 'uninitialized' && State.projectType !== 'plugin') {
      App.flash(`This project is already set up as a ${State.projectType.toUpperCase()} project. Can't mix with plugins.`, true, 'error');
      return false;
    }
    if (State.projectType === 'plugin' && State.pluginId && State.pluginId !== pluginMeta.id) {
      App.flash(`This project already uses another plugin. Can't mix plugins.`, true, 'error');
      return false;
    }
    if (State.projectType === 'uninitialized') {
      State.projectType = 'plugin';
      State.pluginId = pluginMeta.id;
      State.pluginName = pluginMeta.name;
    }
    return true;
  },

  async processPlugin(files) {
    const sorted = files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    const first = sorted[0];
    const meta = AETL.plugins.resolveByExtension(first.name) || AETL.plugins.resolveByMagic(await readHead(first));
    if (!meta) throw new Error(`No active plugin handles the file "${first.name}".`);
    if (!Importer.assertPluginProjectType(meta)) return null;
    const settings = AETL.plugins.projectSettingsFor(meta);
    const startNum = State.nextLineNum();
    const existing = new Set(State.files);
    const imported = [];
    const images = [];
    let cur = startNum;
    const pluginData = State.pluginData && typeof State.pluginData === 'object' ? { ...State.pluginData } : {};
    let cancelled = false;
    Progress.cancellableDeterminate('Plugin: Importing', `0 / ${sorted.length} file`, () => {
      cancelled = true;
      AETL.plugins.abort(meta);
    });
    for (let i = 0; i < sorted.length; i++) {
      if (cancelled) break;
      const f = sorted[i];
      const bn = baseName(f.name);
      if (existing.has(bn)) continue;
      const buffer = new Uint8Array(await f.arrayBuffer());
      if (cancelled) break;
      let out;
      try {
        out = await AETL.plugins.callExtract(meta, { fileName: f.name, buffer, settings });
      } catch (e) {
        if (cancelled) break;
        throw new Error(`Plugin "${meta.name}" failed to parse ${bn}: ${e.message}`);
      }
      const lines = AETL.plugins.normalizePluginLines(out.lines, cur);
      for (const l of lines) l.file = l.file || bn;
      if (lines.length) {
        existing.add(bn);
        for (const l of lines) existing.add(l.file);
        imported.push(...lines);
        cur += lines.length;
      }
      if (out.sourceMap) pluginData[bn] = out.sourceMap;
      if (Array.isArray(out.images)) {
        for (const im of out.images) {
          if (!im) continue;
          let mediaPath = null;
          if (im.blob && State.projectId) {
            const name = makeMediaName(im.file || im.zipPath || im.fileName);
            const bytes = im.blob instanceof Uint8Array ? im.blob
              : im.blob instanceof ArrayBuffer ? new Uint8Array(im.blob)
              : im.blob instanceof Blob ? new Uint8Array(await im.blob.arrayBuffer())
              : null;
            if (bytes) {
              await Storage.writeMediaFile(State.projectId, name, bytes);
              mediaPath = name;
            }
          }
          images.push({
            zipPath: im.zipPath || im.fileName || bn,
            file: im.file || bn,
            isCover: !!im.isCover,
            insertAfter: im.insertAfter == null ? (lines.length ? lines[lines.length - 1].line_num : null) : im.insertAfter,
            mediaPath
          });
        }
      }
      Progress.update(`${i + 1} / ${sorted.length} file`, ((i + 1) / sorted.length) * 100);
      if (i % CFG.chunkSize.fileProgressBatch === 0) await yieldToEvent();
    }
    Progress.disableCancel();
    State.pluginData = pluginData;
    return { imported, skipped: [], existing: Array.from(existing), images, cancelled };
  },

  async process(input, isZip = false) {
    await withProgress('Processing files...', 'Preparing...', async () => {
      const startNum = State.nextLineNum();
      const existing = new Set(State.files);
      let result;
      await AETL.plugins.runHooks('beforeImport', { isZip, startNum });

      if (isZip && input instanceof File) {
        if (!Importer.assertProjectType('json')) return;
        Progress.determinate('Importing ZIP', `0 file`);
        result = await parseZipJson(await input.arrayBuffer(), Array.from(existing), startNum, Progress.update);
      } else {
        const files = Array.from(input).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        let hasJson = false, pluginMatch = null, epubFile = null, zipFile = null, unknown = null;
        for (const f of files) {
          const n = f.name.toLowerCase();
          if (n.endsWith('.epub')) { epubFile = epubFile || f; continue; }
          if (n.endsWith('.json')) { hasJson = true; continue; }
          const byExt = AETL.plugins.resolveByExtension(f.name);
          if (byExt) { pluginMatch = pluginMatch || byExt; continue; }
          const head = await readHead(f);
          const byMagic = AETL.plugins.resolveByMagic(head);
          if (byMagic) { pluginMatch = pluginMatch || byMagic; continue; }
          if (!fileExt(f.name)) {
            if (isEpubHead(head)) { epubFile = epubFile || f; continue; }
            if (isZipHead(head)) { zipFile = zipFile || f; continue; }
            if (isJsonHead(head)) { hasJson = true; continue; }
            unknown = unknown || f.name;
          }
        }

        if (pluginMatch && (epubFile || hasJson || zipFile)) {
          Progress.hide();
          App.flash("Can't mix built-in files (JSON/EPUB) with plugin files in a single import.", true, 'error');
          return;
        }
        if (epubFile && (hasJson || zipFile)) {
          Progress.hide();
          App.flash("Can't mix EPUB and JSON in a single import.", true, 'error');
          return;
        }

        if (pluginMatch) {
          result = await Importer.processPlugin(files);
          if (!result) return;
        } else if (epubFile) {
          if (!Importer.assertProjectType('epub')) return;
          if (State.projectType === 'epub' && State.epubSourceId) {
            Progress.hide();
            App.flash('This project already contains an EPUB.', true, 'error');
            return;
          }
          State.projectType = 'epub';
          State.epubSourceId = MEDIA_EPUB;
          Progress.determinate('Importing EPUB', `0 file`);
          result = await parseEpub(await epubFile.arrayBuffer(), State.epubTags || 'p', Array.from(existing), startNum, State.projectId, Progress.update);
        } else if (zipFile) {
          if (!Importer.assertProjectType('json')) return;
          Progress.determinate('Importing ZIP', `0 file`);
          result = await parseZipJson(await zipFile.arrayBuffer(), Array.from(existing), startNum, Progress.update);
        } else if (unknown) {
          Progress.hide();
          App.flash(`File type "${unknown}" could not be detected. Files without an extension require JSON/EPUB/ZIP format or a plugin with a magic signature.`, true, 'error');
          return;
        } else {
          if (!Importer.assertProjectType('json')) return;
          const fileInputs = [];
          for (const f of files) fileInputs.push({ name: f.name, buffer: await f.arrayBuffer() });
          Progress.determinate('Importing files', `0 / ${fileInputs.length} file`);
          result = await parseFilesList(fileInputs, Array.from(existing), startNum, Progress.update, 'file');
        }
      }

      if (!result) return;

      if (result.imported.length || (result.images && result.images.length)) {
        for (let i = 0; i < result.imported.length; i++) State.lines.push(result.imported[i]);
        State.files = Array.from(result.existing || existing);
        if (result.images && result.images.length) {
          const known = new Set(State.images.map(im => `${im.zipPath}|${im.isCover ? 1 : 0}`));
          for (const im of result.images) {
            const key = `${im.zipPath}|${im.isCover ? 1 : 0}`;
            if (!known.has(key)) { known.add(key); State.images.push(im); }
          }
        }
        State.namesDirty = true;
        State.contentVersion++;
        App.refresh(true);
        State.queueSave();
        const invalidNote = result.invalidEntries ? ` (${result.invalidEntries} entries without \`message\` skipped)` : '';
        const skipNote = result.skipped.length ? ` (${result.skipped.length} duplicate files skipped)` : '';
        if (result.cancelled) {
          App.flash(`Import cancelled. ${result.imported.length} lines saved.${skipNote}${invalidNote}`);
        } else {
          App.flash(`Successfully imported ${result.imported.length} lines.${skipNote}${invalidNote}`);
        }
        AETL.plugins.emit('import', { lineCount: result.imported.length, fileCount: (result.existing || existing).length });
        await AETL.plugins.runHooks('afterImport', { lineCount: result.imported.length, fileCount: (result.existing || existing).length, cancelled: !!result.cancelled });
      } else if (result.cancelled) {
        App.flash('Import cancelled.');
      } else if (result.skipped.length) {
        App.flash(`Import failed: Duplicate files.\n- ${result.skipped.slice(0, CFG.skippedFilesDisplayMax).join('\n- ')}`, true, 'error');
      } else if (result.invalidEntries) {
        App.flash(`No valid lines could be imported. ${result.invalidEntries} entries do not have a "message" field.`, true, 'error');
      } else {
        App.flash('No valid data.');
      }
    }, e => e?.storage ? e.message : `Error:\n${e?.message || e}`);
  },

  async processReplaceJson(files, mode) {
    await withProgress('Processing files...', 'Preparing...', async () => {
      if (!State.lines.length) { App.flash('No active project. Open or create a project first.', true, 'error'); return; }
      const inputs = await readJsonInputs(files);
      if (!inputs.length) { App.flash('No JSON files found.', true, 'error'); return; }

      const isTransMode = mode === 'translation';
      const isOriginalAllMode = mode === 'original';
      const grouped = groupLinesByFile(State.lines);
      const keyMap = buildFileKeyMap(State.files);

      const plan = [];
      const errors = [];

      for (const inp of inputs) {
        let arr, parsed;
        try {
          arr = JSON.parse(decodeBuffer(inp.buffer));
          parsed = parseJsonEntries(arr, inp.name);
        } catch (e) {
          errors.push(`"${inp.name}": ${e.message}`);
          continue;
        }

        const file = keyMap.get(fileKeyOf(inp.name));
        if (!file) {
          errors.push(`"${inp.name}": file not found in project.`);
          continue;
        }

        const fileLines = grouped.get(file) || [];
        const cntAll = fileLines.length;
        const cntTrans = fileLines.filter(isTrans).length;
        const cntUntrans = cntAll - cntTrans;
        const cntJson = parsed.entries.length;

        if (cntJson === 0) {
          errors.push(`"${inp.name}": no valid entries.`);
          continue;
        }

        let targets;
        if (isOriginalAllMode) {
          if (cntJson !== cntAll) {
            errors.push(`"${inp.name}": count mismatch (entries=${cntJson}, total=${cntAll}). Original mode requires importing all lines.`);
            continue;
          }
          targets = fileLines;
        } else if (cntUntrans > 0 && cntJson === cntUntrans) {
          targets = fileLines.filter(l => !isTrans(l));
        } else if (cntTrans > 0 && cntJson === cntTrans) {
          targets = fileLines.filter(isTrans);
        } else if (cntJson === cntAll) {
          targets = fileLines;
        } else {
          errors.push(`"${inp.name}": count mismatch (entries=${cntJson}, untranslated=${cntUntrans}, translated=${cntTrans}, total=${cntAll}).`);
          continue;
        }

        if (!State.ignoreName) {
          for (let i = 0; i < parsed.entries.length; i++) {
            const e = parsed.entries[i];
            const l = targets[i];
            const hasOn = !!(l.name || '').trim();
            const hasTn = !!(e.name || '').trim();
            if (hasOn && !hasTn) {
              errors.push(`"${inp.name}" line ${l.line_num}: Name removed (original has name, JSON does not).`);
            } else if (!hasOn && hasTn) {
              errors.push(`"${inp.name}" line ${l.line_num}: Narrative but has name (original has no name, JSON does).`);
            }
          }
          if (errors.length) continue;
        }

        plan.push({ entries: parsed.entries, targets });
      }

      if (errors.length) {
        const summary = `Import rejected: ${errors.length} files failed validation. No changes applied.`;
        const shown = errors.slice(0, CFG.warningDisplayMax);
        const more = errors.length > CFG.warningDisplayMax ? `\n+${errors.length - CFG.warningDisplayMax} more notes` : '';
        App.flash(`${summary}\n\nRejected:\n${shown.join('\n')}${more}`, true, 'error');
        return;
      }

      const snapshotLines = snapshot();
      let updated = 0;
      for (const { entries, targets } of plan) {
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          const l = targets[i];
          const msg = e.message.replace(_NEWLINE_RE, '\\n').trim();
          const nm = e.name == null ? null : stripNewlines(e.name);
          if (isTransMode) {
            l.trans_message = msg;
            l.trans_name = nm;
            l.is_translated = true;
          } else {
            l.message = msg;
            l.name = nm;
          }
          updated++;
        }
      }

      State.undoStack.push(snapshotLines); State.redoStack = [];
      State.namesDirty = true;
      State.contentVersion++;
      App.refresh(true);
      State.queueSave();

      App.flash(`Successfully updated ${updated} lines.`);
      AETL.plugins.emit('import', { lineCount: updated, fileCount: State.files.length, mode });
    }, e => `Error:\n${e?.message || e}`);
  }
};

