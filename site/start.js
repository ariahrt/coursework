"use strict";
// Loaded last, so every page script is defined before the app starts.

// Ask Claude was removed; forget any API key a browser saved for it.
store.del("claudeKey");

boot();
