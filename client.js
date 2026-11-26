window.__ModuleLoader__.load({
  id: 'ck-rules',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect } = React;

    const C = {
      text: 'var(--dsw-alias-text-1, #1f2328)',
      dim: 'var(--dsw-alias-text-3, #6b7280)',
      line: 'var(--dsw-alias-border-1, #e5e7eb)',
      bg: 'var(--dsw-alias-bg-2, #f8f9fa)',
      ok: '#1a7f37',
      off: '#9a6700',
      bad: '#b42318',
    };

    const modeButtonStyle = (active, disabled) => ({
      padding: '2px 10px',
      borderRadius: 999,
      cursor: disabled ? 'default' : 'pointer',
      fontSize: 12,
      lineHeight: '18px',
      border: `1px solid ${active ? C.ok : C.line}`,
      background: active ? C.ok : 'transparent',
      color: active ? '#fff' : C.text,
      opacity: disabled ? 0.55 : 1,
    });

    // 输入框上方的窄条：显示状态，点开改档位和称呼
    function Dock() {
      const [data, setData] = useState(null);
      const [error, setError] = useState('');
      const [open, setOpen] = useState(false);
      const [draftName, setDraftName] = useState('');
      const [busy, setBusy] = useState('');
      const [notice, setNotice] = useState(null);

      const accept = (d) => {
        setData(d);
        setDraftName(d && d.ownerName ? d.ownerName : '');
        setError('');
      };

      const refresh = () => {
        fetch('/ck-rules/status', { cache: 'no-store', credentials: 'same-origin' })
          .then((r) => r.json())
          .then(accept)
          .catch((e) => setError(String(e && e.message ? e.message : e)));
      };

      useEffect(() => {
        let alive = true;
        fetch('/ck-rules/status', { cache: 'no-store', credentials: 'same-origin' })
          .then((r) => r.json())
          .then((d) => { if (alive) accept(d); })
          .catch((e) => { if (alive) setError(String(e && e.message ? e.message : e)); });
        return () => { alive = false; };
      }, []);

      const submit = async (patch, tag) => {
        if (busy) return;
        setBusy(tag);
        setNotice(null);
        try {
          const res = await fetch('/ck-rules/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(patch),
          });
          let json = null;
          try { json = await res.json(); } catch (e) { json = null; }
          if (!res.ok || !json || json.ok !== true) {
            throw new Error((json && json.error) || `HTTP ${res.status}`);
          }
          setData((prev) => (prev ? { ...prev, mode: json.mode, modeLabel: json.modeLabel, ownerName: json.ownerName } : prev));
          setDraftName(json.ownerName || '');
          setNotice({
            kind: 'ok',
            text: tag === 'mode'
              ? `已经切到「${json.modeLabel}」，下一轮就按这个来。`
              : json.ownerName
                ? `以后就叫你「${json.ownerName}」，下一轮生效。`
                : '称呼清空了，下轮还是用「你」。',
          });
        } catch (e) {
          setNotice({ kind: 'bad', text: `没保存上：${e && e.message ? e.message : e}` });
        } finally {
          setBusy('');
        }
      };

      const saveMode = (mode) => {
        if (!data || data.mode === mode) return;
        if (data.canSave === false) {
          setNotice({ kind: 'bad', text: '这个环境不让保存，只能看。' });
          return;
        }
        submit({ permissionMode: mode }, 'mode');
      };

      const saveName = () => {
        if (!data) return;
        if (data.canSave === false) {
          setNotice({ kind: 'bad', text: '这个环境不让保存，只能看。' });
          return;
        }
        submit({ ownerName: draftName }, 'name');
      };

      const on = data ? data.enabled : false;
      const label = data
        ? `CK的规矩 · ${data.modeLabel}${data.ownerName ? ` · ${data.ownerName}` : ''}`
        : error ? 'CK的规矩 · 读不到状态' : 'CK的规矩 · 读取中…';
      const locked = Boolean(busy) || (data ? data.canSave === false : false);

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 2px' } },
        h('button', {
          type: 'button',
          onClick: () => {
            if (!open) refresh();
            setOpen((v) => !v);
          },
          title: '改权限档位和称呼',
          style: {
            display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
            padding: '3px 9px', borderRadius: 12, cursor: 'pointer', fontSize: 12,
            color: C.text, background: C.bg, border: `1px solid ${C.line}`,
          },
        },
          h('span', {
            style: { width: 6, height: 6, borderRadius: 3, background: on ? C.ok : C.off, display: 'inline-block' },
          }),
          label
        ),

        open ? h('div', {
          style: {
            padding: '10px 12px', borderRadius: 8, background: C.bg, border: `1px solid ${C.line}`,
            fontSize: 12, lineHeight: 1.7, color: C.text, maxWidth: 520,
          },
        },
          error ? h('div', { style: { color: C.bad } }, `读不到状态：${error}`) : null,
          data ? h('div', null,
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              h('span', { style: { color: C.dim } }, '权限档位'),
              ...(data.modes || []).map((m) => h('button', {
                key: m.id,
                type: 'button',
                onClick: () => saveMode(m.id),
                disabled: locked,
                title: m.id,
                style: modeButtonStyle(m.id === data.mode, locked),
              }, m.label))
            ),

            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' } },
              h('span', { style: { color: C.dim } }, '怎么称呼你'),
              h('input', {
                type: 'text',
                value: draftName,
                maxLength: 24,
                placeholder: '留空就用「你」',
                disabled: locked,
                onChange: (e) => setDraftName(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveName();
                  }
                },
                style: {
                  flex: '1 1 140px', minWidth: 120, padding: '3px 8px', fontSize: 12,
                  borderRadius: 6, border: `1px solid ${C.line}`, background: 'transparent', color: C.text,
                },
              }),
              h('button', {
                type: 'button',
                onClick: saveName,
                disabled: locked,
                style: {
                  padding: '2px 10px', borderRadius: 6, cursor: locked ? 'default' : 'pointer',
                  fontSize: 12, border: `1px solid ${C.line}`, background: 'transparent', color: C.text,
                  opacity: locked ? 0.55 : 1,
                },
              }, busy === 'name' ? '保存中…' : '保存')
            ),

            notice ? h('div', { style: { marginTop: 4, color: notice.kind === 'ok' ? C.ok : C.bad } }, notice.text) : null,
            data.canSave === false ? h('div', { style: { marginTop: 4, color: C.off } }, '这个环境不让保存，只能看。') : null,

            h('div', { style: { marginTop: 6, color: C.dim } },
              `规矩 ${data.promptChars} 字${data.promptMissing ? '（文件读不到）' : ''} · 改完下一轮生效，不用重启`),
            h('div', { style: { wordBreak: 'break-all', color: C.dim } }, `文件：${data.promptFile}`)
          ) : null
        ) : null
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'ck-rules-dock',
          order: 5,
        }, Dock));
      },
    };
  },
});
