import { useEffect, useMemo, useState } from 'react';
import s from './GetAllImages.module.scss';

export default function GetAllImages({
                                         baseUrl = 'http://192.168.27.34:8000',
                                         autoRefreshMs = 0, // 0 = без авто-обновления
                                     }) {
    const [folders, setFolders] = useState([]);
    const [images, setImages] = useState([]);
    const [currentFolder, setCurrentFolder] = useState(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState({});
    const [busyDelete, setBusyDelete] = useState(false);

    const hasElectron = useMemo(() => !!(window && window.electronAPI?.listFolders), []);

    // -------------------- load folders --------------------
    const loadFolders = async () => {
        setLoading(true);
        setErr('');
        try {
            if (!hasElectron) throw new Error('Run via Electron window (no window.electronAPI)');
            const list = await window.electronAPI.listFolders(baseUrl);
            setFolders(list);
            setImages([]);
            setCurrentFolder(null);
            setSelected({});
        } catch (e) {
            setErr(e.message || String(e));
        } finally {
            setLoading(false);
        }
    };

    // -------------------- load images --------------------
    const loadImages = async (folder) => {
        setLoading(true);
        setErr('');
        try {
            const imgs = await window.electronAPI.listImages(folder.url);
            setImages(imgs);
            setCurrentFolder(folder);
        } catch (e) {
            setErr(e.message || String(e));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadFolders();
        if (autoRefreshMs > 0) {
            const t = setInterval(loadFolders, autoRefreshMs);
            return () => clearInterval(t);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [baseUrl, autoRefreshMs]);

    const filteredFolders = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return folders;
        return folders.filter((f) => f.name.toLowerCase().includes(q));
    }, [folders, query]);

    // -------------------- zip download --------------------
    const downloadZip = async (folder) => {
        try {
            const zipPath = await window.electronAPI.pickZipPath(`${folder.name}.zip`);
            if (!zipPath) return;
            await window.electronAPI.makeZipAll({ folderUrl: folder.url, zipPath });
            alert(`✅ Saved: ${zipPath}`);
        } catch (e) {
            alert(`❌ ${e.message}`);
        }
    };

    // -------------------- delete selected --------------------
    const allSelectedUrls = folders.filter(f => selected[f.url]).map(f => f.url);

    const toggleSelect = (url) => {
        setSelected(prev => ({ ...prev, [url]: !prev[url] }));
    };

    const deleteSelected = async () => {
        if (!allSelectedUrls.length) return;
        if (!window.confirm(`Удалить ${allSelectedUrls.length} выбранных папок?`)) return;
        setBusyDelete(true);
        try {
            const res = await window.electronAPI.deleteFoldersRemote(allSelectedUrls);
            if (!res.ok) {
                const bad = (res.results || []).filter(r => !r.ok).map(r => `${r.url} (${r.status || r.error})`);
                alert('Некоторые не удалены:\n' + bad.join('\n'));
            } else {
                alert('✅ Все выбранные папки удалены');
            }
            await loadFolders();
        } catch (e) {
            alert('Ошибка удаления: ' + e.message);
        } finally {
            setBusyDelete(false);
        }
    };

    // -------------------- download single image --------------------
    const downloadOne = async (img) => {
        try {
            if (window.electronAPI?.saveImage) {
                await window.electronAPI.saveImage(img.url, img.name);
            } else {
                const res = await fetch(img.url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const blob = await res.blob();
                const href = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = href;
                a.download = img.name;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(href);
            }
        } catch (e) {
            alert(`❌ ${e.message}`);
        }
    };

    // ============================================================== //
    //                       RENDER                                   //
    // ============================================================== //

    // ---------- если открыт конкретный folder ----------
    if (currentFolder) {
        return (
            <div className={s.wrap}>
                <div className={s.header}>
                    <div className={s.left}>
                        <button className={s.btn} onClick={loadFolders}>← Back</button>
                        <h3 className={s.title}>Photos in {currentFolder.name}</h3>
                    </div>
                    <div className={s.right}>
                        <button className={s.btnPrimary} onClick={() => downloadZip(currentFolder)}>
                            Download All as ZIP
                        </button>
                    </div>
                </div>

                {err && <div className={s.error}>⚠ {err}</div>}
                {loading && <div className={s.loading}>Loading...</div>}

                <div className={s.gridPhotos}>
                    {images.map((img) => (
                        <div key={img.url} className={s.photoItem}>
                            <a href={img.url} target="_blank" rel="noreferrer">
                                <img src={img.url} alt={img.name} className={s.photoThumb} />
                            </a>
                            <div className={s.photoName}>{img.name}</div>
                            <button className={s.downloadBtn} onClick={() => downloadOne(img)}>
                                Download
                            </button>
                        </div>
                    ))}
                    {!loading && !err && images.length === 0 && (
                        <div className={s.empty}>No images in this folder</div>
                    )}
                </div>
            </div>
        );
    }

    // ---------- иначе отображаем список всех папок ----------
    return (
        <div className={s.wrap}>
            <div className={s.header}>
                <div className={s.left}>
                    {/*<h3 className={s.title}>Folders at {baseUrl}</h3>*/}
                    <div className={s.controls}>
                        <input
                            className={s.input}
                            placeholder="Search folders…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                        <button className={s.btn} onClick={loadFolders} disabled={loading}>
                            {loading ? 'Refreshing…' : 'Refresh'}
                        </button>
                        {allSelectedUrls.length > 0 && (
                            <button
                                className={s.btnDanger}
                                onClick={deleteSelected}
                                disabled={busyDelete}
                            >
                                {busyDelete ? 'deleting..' : `delete (${allSelectedUrls.length})`}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {err && <div className={s.error}>⚠ {err}</div>}

            <div className={s.grid}>
                {filteredFolders.map((f) => (
                    <div
                        key={f.url}
                        className={`${s.folder} ${selected[f.url] ? s.selected : ''}`}
                        title={f.url}
                        onClick={() => loadImages(f)}
                    >
                        <div className={s.checkbox} onClick={(e) => e.stopPropagation()}>
                            <input
                                type="checkbox"
                                checked={!!selected[f.url]}
                                onChange={() => toggleSelect(f.url)}
                            />
                        </div>
                        <span className={s.icon} aria-hidden></span>
                        <span className={s.name}>{f.name}</span>
                    </div>
                ))}
                {!loading && !err && filteredFolders.length === 0 && (
                    <div className={s.empty}>No folders</div>
                )}
            </div>
        </div>
    );
}
