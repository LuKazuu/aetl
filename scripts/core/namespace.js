// AETL - Global namespace bootstrap
'use strict';

// Single shared namespace object exposed on window so other scripts
// (loaded with defer) can attach utilities, dialogs, plugins, etc.
window.AETL = window.AETL || {};
