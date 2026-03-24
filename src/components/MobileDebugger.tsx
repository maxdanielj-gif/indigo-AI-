import React, { useEffect, useRef, useState } from 'react';

const MobileDebugger: React.FC = () => {
  const [isEnabled, setIsEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('debug') === 'true') {
        localStorage.setItem('indigo_debugger_enabled', 'true');
        return true;
      }
      return localStorage.getItem('indigo_debugger_enabled') === 'true';
    }
    return false;
  });

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'indigo_debugger_enabled') {
        setIsEnabled(e.newValue === 'true');
      }
    };
    window.addEventListener('storage', handleStorageChange);
    
    // Also check periodically or on a custom event if needed, 
    // but storage event works for cross-tab. 
    // For same-tab, we can use a custom event.
    const handleCustomEvent = () => {
      setIsEnabled(localStorage.getItem('indigo_debugger_enabled') === 'true');
    };
    window.addEventListener('indigo_debugger_toggle', handleCustomEvent);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('indigo_debugger_toggle', handleCustomEvent);
    };
  }, []);

  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const consoleBoxRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const statusBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.log("MobileDebugger mounted, isEnabled:", isEnabled);
    if (!isEnabled) return;

    (function () {
      'use strict';
      console.log("MobileDebugger IIFE starting...");

      /* ── State ── */
      const output      = document.getElementById('debug-output') as HTMLDivElement;
      const input       = document.getElementById('debug-input') as HTMLTextAreaElement;
      const console_box = document.getElementById('mobile-debug-console') as HTMLDivElement;
      const contextMenu = document.getElementById('debug-context-menu') as HTMLDivElement;
      const suggestions = document.getElementById('debug-suggestions') as HTMLDivElement;
      const statusBar   = document.getElementById('debug-status') as HTMLDivElement;

      if (!output || !input || !console_box || !contextMenu || !suggestions || !statusBar) return;

      let selectedEntry  : HTMLElement | null = null;
      let currentFilter  = 'all';
      let currentSearch  = '';
      let cmdHistory     : string[] = [];
      let historyIdx     = 0;
      let entryCount     = 0;
      let isCollapsed    = false;

      const JS_KEYWORDS = [
        'break','case','catch','class','const','continue','debugger','default',
        'delete','do','else','export','extends','finally','for','function','if',
        'import','in','instanceof','new','return','super','switch','this','throw',
        'try','typeof','var','void','while','with','yield',
        'console','document','window','JSON','Math','Object','Array','String',
        'Number','Boolean','fetch','localStorage','sessionStorage','navigator',
        'location','setTimeout','setInterval','clearTimeout','clearInterval',
        'Promise','Map','Set','WeakMap','WeakSet','Symbol','Reflect','Proxy',
        'undefined','null','true','false','Infinity','NaN'
      ];

      /* ── Preserve originals before overriding ── */
      /* ── Log renderer ── */
      function safeStringify(obj: any, maxDepth = 2, maxLen = 1000) {
        const cache = new Set();
        function helper(val: any, depth: number): any {
          if (depth > maxDepth) return '[Object]';
          if (val === null) return 'null';
          if (typeof val === 'undefined') return 'undefined';
          if (typeof val !== 'object') {
            const s = String(val);
            return s.length > maxLen ? s.substring(0, maxLen) + '...' : s;
          }
          if (cache.has(val)) return '[Circular]';
          cache.add(val);
          
          if (Array.isArray(val)) {
            const res = val.slice(0, 10).map(i => helper(i, depth + 1));
            if (val.length > 10) res.push(`... ${val.length - 10} more items`);
            return res;
          }
          
          const res: any = {};
          const keys = Object.keys(val).slice(0, 20);
          keys.forEach(k => {
            res[k] = helper(val[k], depth + 1);
          });
          if (Object.keys(val).length > 20) res['__more__'] = `${Object.keys(val).length - 20} more keys`;
          return res;
        }
        try {
          return JSON.stringify(helper(obj, 0), null, 2);
        } catch (e) {
          return String(obj);
        }
      }

      function createLogEntry(args: IArguments | any[], type: string) {
        type = type || 'log';
        entryCount++;

        const message = Array.from(args).map(function(a) {
          if (a instanceof Error) return a.message + '\n' + (a.stack || '');
          if (a !== null && typeof a === 'object') {
            return safeStringify(a);
          }
          return String(a);
        }).join(' ');

        const div = document.createElement('div');
        div.className = 'log-entry type-' + type;
        div.dataset.type    = type;
        div.dataset.message = message;
        div.textContent = '[' + new Date().toLocaleTimeString() + '] ' + message;

        if (!shouldShow(type, message)) div.style.display = 'none';

        return div;
      }

      function appendLog(args: IArguments | any[], type: string, skipScroll = false) {
        const div = createLogEntry(args, type);
        output.appendChild(div);
        if (!skipScroll) {
          output.scrollTop = output.scrollHeight;
        }
        updateStatus();
      }

      function updateStatus() {
        // Optimization: don't query every time if we can avoid it
        // For initial load, we can call it once at the end
        if (output.children.length % 10 === 0 || output.children.length < 10) {
          var visible = output.querySelectorAll('.log-entry:not([style*="display: none"])').length;
          statusBar.textContent = entryCount + ' entries' + (visible < entryCount ? ' (' + visible + ' shown)' : '');
        }
      }

      function shouldShow(type: string, message: string) {
        var okFilter = (currentFilter === 'all' || type === currentFilter);
        var okSearch = message.toLowerCase().indexOf(currentSearch.toLowerCase()) !== -1;
        return okFilter && okSearch;
      }

      function applyFilters() {
        var logs = output.children;
        for (var i = 0; i < logs.length; i++) {
          var log = logs[i] as HTMLElement;
          log.style.display = shouldShow(log.dataset.type!, log.dataset.message!) ? '' : 'none';
        }
        updateStatus();
      }

      /* ── Global error catchers ── */
      window.onerror = function(msg, url, line, col, err) {
        appendLog(['Uncaught Error: ' + msg + ' (line ' + line + (col ? ':' + col : '') + ')' + (err && err.stack ? '\n' + err.stack : '')], 'error');
        return false;
      };

      window.addEventListener('unhandledrejection', function(e: any) {
        var reason = e.reason;
        var msg = reason instanceof Error ? reason.message + (reason.stack ? '\n' + reason.stack : '') : String(reason);
        appendLog(['Unhandled Promise rejection: ' + msg], 'error');
      });

      /* ── Autocomplete ── */
      input.addEventListener('input', function() {
        var text   = input.value;
        var cursor = input.selectionStart;
        var before = text.substring(0, cursor);
        var dotMatch = before.match(/([a-zA-Z0-9_$]+)\.([a-zA-Z0-9_$]*)$/);
        var list: string[] = [], prefix = '';

        if (dotMatch) {
          prefix = dotMatch[2];
          try {
            /* eslint-disable no-eval */
            var obj = eval(dotMatch[1]); // intentional
            if (obj != null) {
              var props: string[] = [];
              var o = obj;
              while (o) { props = props.concat(Object.getOwnPropertyNames(o)); o = Object.getPrototypeOf(o); }
              list = props.filter(function(p) { return p.indexOf(prefix) === 0 && p !== prefix; });
            }
          } catch(e) {}
        } else {
          var words = before.split(/[^a-zA-Z0-9_$]/);
          prefix = words[words.length - 1];
          if (prefix.length >= 2) {
            list = Array.from(new Set(JS_KEYWORDS.concat(cmdHistory))).filter(function(s) {
              return s.indexOf(prefix) === 0 && s !== prefix;
            });
          }
        }

        if (list.length) {
          suggestions.innerHTML = '';
          list.slice(0, 12).forEach(function(s) {
            var d = document.createElement('div');
            d.className = 'suggestion-item';
            d.textContent = s;
            d.onmousedown = d.ontouchstart = (function(e: any) {
              e.preventDefault();
              var pos = cursor - prefix.length;
              input.value = text.substring(0, pos) + s + text.substring(cursor);
              suggestions.style.display = 'none';
              input.focus();
            }) as any;
            suggestions.appendChild(d);
          });
          suggestions.style.display = 'block';
        } else {
          suggestions.style.display = 'none';
        }
      });

      /* ── Keyboard navigation ── */
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Tab' && suggestions.style.display === 'block') {
          e.preventDefault();
          suggestions.firstElementChild && (suggestions.firstElementChild as HTMLElement).onmousedown!(e as any);
          return;
        }
        if ((e.key === 'Enter' && e.ctrlKey)) {
          e.preventDefault();
          (window as any).runInput();
          return;
        }
        if (e.key === 'ArrowUp' && historyIdx > 0) {
          e.preventDefault();
          historyIdx--;
          input.value = cmdHistory[historyIdx];
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (historyIdx < cmdHistory.length - 1) { historyIdx++; input.value = cmdHistory[historyIdx]; }
          else { historyIdx = cmdHistory.length; input.value = ''; }
        }
      });

      /* ── Run code ── */
      (window as any).runInput = function() {
        suggestions.style.display = 'none';
        var code = input.value.trim();
        if (!code) return;
        cmdHistory.push(code);
        historyIdx = cmdHistory.length;
        appendLog(['> ' + code], 'system');

        /* Syntax check first */
        try { new Function(code); } catch(err: any) {
          appendLog(['Syntax Error: ' + err.message], 'error');
          return;
        }
        /* Execute */
        try {
          /* eslint-disable no-eval */
          var result = eval(code); // intentional – this is a REPL
          if (result !== undefined) appendLog([result], 'log');
        } catch(err: any) {
          appendLog([err], 'error');
        }
        input.value = '';
        input.style.height = 'auto';
      };

      /* ── Header click (toggle if clicking the label area, not controls) ── */
      (window as any).handleHeaderClick = function(e: any) {
        // only toggle if click originated on header itself, not a child control
        if (e.target.id === 'debug-header' || e.target.tagName === 'SPAN') (window as any).toggleDebug();
      };

      /* ── UI controls ── */
      (window as any).toggleDebug = function() {
        isCollapsed = !isCollapsed;
        console_box.style.height = isCollapsed ? '38px' : '30%';
        document.getElementById('debug-toggle-btn')!.textContent = isCollapsed ? 'Expand' : 'Collapse';
        document.querySelector('body')!.style.paddingBottom = isCollapsed ? '38px' : '30vh';
      };

      (window as any).clearDebug = function() {
        output.innerHTML = '';
        entryCount = 0;
        updateStatus();
      };

      (window as any).filterLogs = function(level: string) {
        currentFilter = level;
        applyFilters();
      };

      (window as any).searchLogs = function(query: string) {
        currentSearch = query;
        applyFilters();
      };

      (window as any).saveToFile = function() {
        var text = Array.from(output.querySelectorAll('.log-entry')).map(function(d) {
          return d.textContent;
        }).join('\n');
        var blob = new Blob([text], { type: 'text/plain' });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        a.href     = url;
        a.download = 'debug-log-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        appendLog(['Log saved to file.'], 'system');
      };

      (window as any).copyToClipboard = function() {
        var text = Array.from(output.querySelectorAll('.log-entry')).map(function(d) {
          return d.textContent;
        }).join('\n');
        navigator.clipboard.writeText(text).then(function() {
          appendLog(['All logs copied to clipboard.'], 'system');
        }).catch(function(err) {
          appendLog(['Clipboard copy failed: ' + err], 'error');
        });
      };

      (window as any).copyLogMessage = function() {
        contextMenu.style.display = 'none';
        if (!selectedEntry) return;
        navigator.clipboard.writeText((selectedEntry as HTMLElement).dataset.message!).then(function() {
          appendLog(['Message copied.'], 'system');
        });
      };

      (window as any).viewLogDetails = function() {
        contextMenu.style.display = 'none';
        if (selectedEntry) alert((selectedEntry as HTMLElement).dataset.message);
      };

      /* ── Dismiss context menu ── */
      document.addEventListener('click',      function() { contextMenu.style.display = 'none'; });
      document.addEventListener('touchstart', function() { contextMenu.style.display = 'none'; }, { passive: true });

      /* ── Auto-resize textarea ── */
      input.addEventListener('input', function() {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 80) + 'px';
      });

      /* ── Ready ── */
      appendLog(['Mobile Debugger ready. Ctrl+Enter or tap Run to execute code.'], 'system');

      /* ── Event Delegation for Logs ── */
      let pressTimer: any;
      output.addEventListener('contextmenu', function(e) {
        const target = (e.target as HTMLElement).closest('.log-entry') as HTMLElement;
        if (target) {
          e.preventDefault();
          selectedEntry = target;
          contextMenu.style.display = 'block';
          contextMenu.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
          contextMenu.style.top  = Math.min(e.clientY, window.innerHeight - 80) + 'px';
        }
      });

      output.addEventListener('touchstart', (e: any) => {
        const target = (e.target as HTMLElement).closest('.log-entry') as HTMLElement;
        if (target) {
          pressTimer = setTimeout(function() {
            selectedEntry = target;
            var t = e.touches[0];
            contextMenu.style.display = 'block';
            contextMenu.style.left = Math.min(t.clientX, window.innerWidth - 180) + 'px';
            contextMenu.style.top  = Math.min(t.clientY, window.innerHeight - 80) + 'px';
          }, 600);
        }
      }, { passive: true });

      output.addEventListener('touchend', function() { clearTimeout(pressTimer); }, { passive: true });
      output.addEventListener('touchmove', function() { clearTimeout(pressTimer); }, { passive: true });

      /* ── Load buffered logs ── */
      if ((window as any)._logBuffer && (window as any)._logBuffer.length > 0) {
        const fragment = document.createDocumentFragment();
        const buffer = (window as any)._logBuffer;
        // If buffer is huge, only show last 300 to keep it fast
        const startIdx = Math.max(0, buffer.length - 300);
        if (startIdx > 0) {
          const info = document.createElement('div');
          info.className = 'log-entry type-system';
          info.textContent = `... ${startIdx} older logs hidden for performance ...`;
          fragment.appendChild(info);
        }
        
        for (let i = startIdx; i < buffer.length; i++) {
          const div = createLogEntry(buffer[i].args, buffer[i].type);
          fragment.appendChild(div);
        }
        
        output.appendChild(fragment);
        output.scrollTop = output.scrollHeight;
        // Force update status once after batch load
        var visible = output.querySelectorAll('.log-entry:not([style*="display: none"])').length;
        statusBar.textContent = entryCount + ' entries' + (visible < entryCount ? ' (' + visible + ' shown)' : '');
      }

      /* ── Register listener for new logs ── */
      (window as any)._logListener = (item: any) => {
        appendLog(item.args, item.type);
      };

      // Expose for external access
      (window as any).getLogs = () => (window as any)._logBuffer;
      (window as any).clearLogs = () => {
        (window as any)._logBuffer = [];
        sessionStorage.setItem('indigo_log_buffer', '[]');
        (window as any).clearDebug();
      };
    })();
    
    // Cleanup on unmount
    return () => {
      (window as any)._logListener = null;
    };
  }, [isEnabled]);


  if (!isEnabled) return null;

  return (
    <div id="mobile-debug-console" ref={consoleBoxRef} className="fixed bottom-0 left-0 w-full h-[30%] bg-[#1a1a1a] text-[#00ff00] font-mono text-[12px] z-[999999] border-t-2 border-[#444] flex flex-col transition-height duration-300 box-border">
      <div id="debug-context-menu" className="hidden absolute bg-[#333] border border-[#555] z-[1000000] p-[4px_0]">
        <div className="p-[6px_12px] cursor-pointer hover:bg-[#444]" onClick={() => (window as any).copyLogMessage()}>Copy Message</div>
        <div className="p-[6px_12px] cursor-pointer hover:bg-[#444]" onClick={() => (window as any).viewLogDetails()}>View Details</div>
      </div>
      <div id="debug-header" onClick={(e) => (window as any).handleHeaderClick(e)} className="bg-[#333] p-[6px_8px] flex justify-between items-center shrink-0 flex-wrap gap-[4px] cursor-pointer select-none">
        <span onClick={(e) => (window as any).handleHeaderClick(e)}>🐛 Mobile Debugger</span>
        <div id="debug-controls" className="flex items-center flex-wrap gap-[4px]">
          <input type="text" id="debug-search" placeholder="Search..." onChange={(e) => (window as any).searchLogs(e.target.value)} className="w-[70px] bg-[#555] text-white border-none p-[3px_7px] font-mono text-[11px] rounded-[2px]" />
          <select id="debug-filter" onChange={(e) => (window as any).filterLogs(e.target.value)} className="bg-[#555] text-white border-none p-[3px_7px] font-mono text-[11px] rounded-[2px]">
            <option value="all">All</option>
            <option value="log">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
            <option value="system">System</option>
          </select>
          <button onClick={() => (window as any).saveToFile()} className="bg-[#555] text-white border-none p-[3px_7px] font-mono text-[11px] cursor-pointer rounded-[2px]">Save</button>
          <button onClick={() => (window as any).copyToClipboard()} className="bg-[#555] text-white border-none p-[3px_7px] font-mono text-[11px] cursor-pointer rounded-[2px]">Copy</button>
{/* Sync removed */}
          <button onClick={() => (window as any).clearDebug()} className="bg-[#555] text-white border-none p-[3px_7px] font-mono text-[11px] cursor-pointer rounded-[2px]">Clear</button>
          <button id="debug-toggle-btn" onClick={() => (window as any).toggleDebug()} className="bg-[#555] text-white border-none p-[3px_7px] font-mono text-[11px] cursor-pointer rounded-[2px]">Collapse</button>
        </div>
      </div>

      <div id="debug-output" ref={outputRef} className="flex-grow overflow-y-auto p-[6px_10px] whitespace-pre-wrap border-b border-[#333]"></div>

      <div id="debug-status" ref={statusBarRef} className="text-[10px] text-[#666] p-[2px_8px] shrink-0 border-t border-[#2a2a2a]">0 entries</div>

      <div id="debug-input-area" className="flex flex-col bg-[#222] shrink-0 relative">
        <div id="debug-suggestions" ref={suggestionsRef} className="hidden absolute bottom-full left-0 right-0 bg-[#333] text-white border border-[#555] max-h-[120px] overflow-y-auto z-[1000001]"></div>
        <div id="debug-input-row" className="flex items-start">
          <span className="p-[8px_6px] text-[#aaa] shrink-0">&gt;</span>
          <textarea id="debug-input" ref={inputRef} placeholder="Run JS… (Ctrl+Enter or long-press Run to execute)" rows={1} className="flex-grow bg-transparent border-none text-white p-[8px_4px] outline-none font-mono text-[12px] resize-none min-h-[36px] max-h-[80px]"></textarea>
          <button onClick={() => (window as any).runInput()} className="bg-[#336633] text-white border-none p-[4px_10px] font-mono cursor-pointer self-stretch rounded-none">Run</button>
        </div>
      </div>
    </div>
  );
};

export default MobileDebugger;
