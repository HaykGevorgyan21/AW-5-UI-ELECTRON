// src/FoldersView.jsx
import { useEffect, useMemo, useState } from 'react';

export default function FoldersView({ defaultBaseUrl = 'http://192.168.4.1:8000' }) {
    const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
    const [query, setQuery] = useState('');
    const [folders, setFolders] = useState([]);
    const [selected, setSelected] = useState({});
    const [loading, setLoading] = useState(false);
    const [busyDelete, setBusyDelete] = useState(false);
    const [busyDownload, setBusyDownload] = useState(false);
    const [msg, setMsg] = useState('');

    const hasElectron = useMemo(() => !!(window && window.electronAPI?.listFolders), []);

    const refresh = async () => {
        setMsg('');
        if (!hasElectron) {
            setMsg('Run via Electron window (no electronAPI)');
            return;
        }
        setLoading(true);
        try {
            const list = await window.electronAPI.listFolders(baseUrl);
            setFolders(list);
        } catch (e) {
            setMsg(String(e?.message || e));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [baseUrl]);

    const filtered = folders.filter(f =>
        !query.trim() || f.name.toLowerCase().includes(query.toLowerCase())
    );

    const toggle = (url) => setSelected(s => ({ ...s, [url]: !s[url] }));

    const allSelectedUrls = filtered.filter(f => selected[f.url]).map(f => f.url);
    const isAllSelected = filtered.length > 0 && allSelectedUrls.length === filtered.length;

    const toggleAll = () => {
        if (isAllSelected) {
            const next = { ...selected };
            for (const f of filtered) delete next[f.url];
            setSelected(next);
        } else {
            const next = { ...selected };
            for (const f of filtered) next[f.url] = true;
            setSelected(next);
        }
    };

    const onDelete = async () => {
        if (!allSelectedUrls.length) return;
        setBusyDelete(true); setMsg('');
        try {
            const res = await window.electronAPI.deleteFoldersRemote(allSelectedUrls);
            if (!res.ok) {
                const failed = (res.results || [])
                    .filter(r => !r.ok)
                    .map(r => `${r.url} (${r.status || r.error})`);
                setMsg(`Удалены не все: ${failed.join(', ')}`);
            } else {
                setMsg('Готово: все выбранные папки удалены.');
            }
            await refresh();
            setSelected({});
        } catch (e) {
            setMsg(String(e?.message || e));
        } finally {
            setBusyDelete(false);
        }
    };

    const onDownloadSelected = async () => {
        if (!allSelectedUrls.length) return;
        setBusyDownload(true); setMsg('');
        const results = [];
        try {
            for (const url of allSelectedUrls) {
                const f = folders.find(x => x.url === url);
                const safe = (f?.name || 'folder').replace(/[\\/:*?"<>|]/g, '_');
                const suggested = `${safe}.zip`;
                try {
                    const zipPath = await window.electronAPI.pickZipPath(suggested);
                    if (!zipPath) { results.push({ url, ok:false, note:'пропущено пользователем' }); continue; }
                    const r = await window.electronAPI.makeZipAll({ folderUrl: url, zipPath });
                    if (r?.ok) results.push({ url, ok:true, zipPath, count: r.count });
                    else results.push({ url, ok:false, note:'makeZipAll вернул ошибку' });
                } catch (err) {
                    results.push({ url, ok:false, note:String(err?.message || err) });
                }
            }
            const ok = results.filter(r=>r.ok);
            const bad = results.filter(r=>!r.ok);
            let summary = `Скачано: ${ok.length}/${results.length}.`;
            if (ok.length) summary += `\nУспешно:\n` + ok.map(r=>`• ${r.url} → ${r.zipPath} (${r.count} файлов)`).join('\n');
            if (bad.length) summary += `\nНе удалось:\n` + bad.map(r=>`• ${r.url} (${r.note || 'ошибка'})`).join('\n');
            setMsg(summary);
        } finally {
            setBusyDownload(false);
        }
    };

    return (
        <div style={{ padding: 16 }}>
            {/* Toolbar */}
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:12 }}>
                <input
                    style={{ minWidth: 260, padding:8, borderRadius:8, border:'1px solid #333', background:'transparent' }}
                    placeholder="Search folders..."
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                />
                <button onClick={refresh} disabled={loading || busyDelete || busyDownload}>
                    {loading ? 'Refreshing…' : 'Refresh'}
                </button>
                <button onClick={toggleAll} disabled={!filtered.length || busyDelete || busyDownload}>
                    {isAllSelected ? `Clear all (${filtered.length})` : `Select all (${filtered.length})`}
                </button>
                <button
                    onClick={onDownloadSelected}
                    disabled={!allSelectedUrls.length || busyDelete || busyDownload || !hasElectron}
                >
                    {busyDownload ? 'Downloading…' : `Download selected folders (${allSelectedUrls.length})`}
                </button>
                <button
                    onClick={onDelete}
                    disabled={!allSelectedUrls.length || busyDelete || busyDownload || !hasElectron}
                >
                    {busyDelete ? 'Deleting…' : `Delete selected (${allSelectedUrls.length})`}
                </button>
                <span style={{ opacity:0.7, fontSize:12 }}>Base URL:</span>
                <input
                    style={{ minWidth: 260, padding:8, borderRadius:8, border:'1px solid #333', background:'transparent' }}
                    value={baseUrl}
                    onChange={e => setBaseUrl(e.target.value)}
                />
            </div>

            {msg && (
                <pre style={{ whiteSpace:'pre-wrap', background:'rgba(0,0,0,0.1)', padding:8, borderRadius:8, marginBottom:12 }}>
          {msg}
        </pre>
            )}

            {/* Grid */}
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: 12,
                }}
            >
                {filtered.map(f => (
                    <div key={f.url} style={{
                        padding: 12,
                        borderRadius: 12,
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.08)',
                    }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                            <input
                                type="checkbox"
                                checked={!!selected[f.url]}
                                onChange={() => toggle(f.url)}
                                disabled={busyDelete || busyDownload}
                                title={f.url}
                            />
                            <span style={{ opacity:0.6, fontSize:12 }}>{new URL(f.url).pathname.replace(/\/$/, '')}</span>
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                            <div style={{
                                width:40, height:30, borderRadius:6,
                                background:'linear-gradient(0deg, rgba(255,190,0,1) 0%, rgba(255,210,60,1) 100%)'
                            }}/>
                            <a href={f.url} target="_blank" rel="noreferrer" style={{ textDecoration:'none' }}>
                                {f.name}
                            </a>
                        </div>
                    </div>
                ))}
            </div>

            {!filtered.length && !loading && (
                <div style={{ opacity:0.8, marginTop:12 }}>Список пуст или не найдено по фильтру.</div>
            )}
        </div>
    );
}
