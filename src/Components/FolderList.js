// src/components/FolderList.js
import { useEffect, useState } from 'react';

export default function FolderList({ baseUrl = 'http://192.168.27.34:8000' }) {
    const [folders, setFolders] = useState([]);
    const [selected, setSelected] = useState({});
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');

    useEffect(() => {
        (async () => {
            try {
                const list = await window.electronAPI.listFolders(baseUrl);
                setFolders(list);
            } catch (e) {
                setMsg(String(e?.message || e));
            }
        })();
    }, [baseUrl]);

    const toggle = (url) => setSelected(s => ({ ...s, [url]: !s[url] }));

    const allSelectedUrls = folders.filter(f => selected[f.url]).map(f => f.url);

    const onDelete = async () => {
        if (!allSelectedUrls.length) return;
        setBusy(true); setMsg('');
        try {
            const res = await window.electronAPI.deleteFoldersRemote(allSelectedUrls);
            if (!res.ok) {
                const failed = (res.results || []).filter(r => !r.ok).map(r => `${r.url} (${r.status||r.error})`);
                setMsg(`Удалены не все: ${failed.join(', ')}`);
            } else {
                setMsg('Готово: все выбранные папки удалены.');
            }
            const list = await window.electronAPI.listFolders(baseUrl);
            setFolders(list);
            setSelected({});
        } catch (e) {
            setMsg(String(e?.message || e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={{padding:16}}>
            <h2>Папки</h2>
            {msg && <div style={{margin:'8px 0', opacity:0.9}}>{msg}</div>}
            <ul style={{listStyle:'none', padding:0}}>
                {folders.map(f => (
                    <li key={f.url} style={{display:'flex', alignItems:'center', gap:8}}>
                        <input
                            type="checkbox"
                            checked={!!selected[f.url]}
                            onChange={() => toggle(f.url)}
                        />
                        <a href={f.url} target="_blank" rel="noreferrer">{f.name}</a>
                    </li>
                ))}
            </ul>
            <button disabled={busy || !allSelectedUrls.length} onClick={onDelete}>
                {busy ? 'deleting..' : `delete (${allSelectedUrls.length})`}
            </button>
        </div>
    );
}
