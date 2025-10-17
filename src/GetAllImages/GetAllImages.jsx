import { useEffect, useMemo, useState } from 'react';
import s from './GetAllImages.module.scss';

export default function GetAllImages({
                                         baseUrl = 'http://192.168.4.1:8000',
                                         autoRefreshMs = 0,
                                     }) {
    const [folders, setFolders] = useState([]);
    const [images, setImages] = useState([]);
    const [currentFolder, setCurrentFolder] = useState(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState({});          // folders selection
    const [selectedPhotos, setSelectedPhotos] = useState({}); // photos selection
    const [busyDelete, setBusyDelete] = useState(false);
    const [busy, setBusy] = useState({ active: false, text: '' });

    const setBusyText = (text) => setBusy({ active: true, text });
    const clearBusy = () => setBusy({ active: false, text: '' });
    const hasElectron = useMemo(() => !!(window && window.electronAPI?.listFolders), []);

    // -------------------- load folders --------------------
    const loadFolders = async () => {
        setLoading(true); setErr('');
        try {
            if (!hasElectron) throw new Error('Run via Electron window (no window.electronAPI)');
            const list = await window.electronAPI.listFolders(baseUrl);
            setFolders(list);
            setImages([]); setCurrentFolder(null);
            setSelected({}); setSelectedPhotos({});
        } catch (e) {
            setErr('Please check the Wi-Fi device or restart it. ' + String(e?.message || e));
        } finally { setLoading(false); }
    };

    // -------------------- load images --------------------
    const loadImages = async (folder) => {
        setLoading(true); setErr('');
        try {
            const imgs = await window.electronAPI.listImages(folder.url);
            setImages(imgs);
            setCurrentFolder(folder);
            setSelectedPhotos({}); // сбрасываем выбор при входе в папку
        } catch (e) {
            setErr(e.message || String(e));
        } finally { setLoading(false); }
    };

    useEffect(() => {
        loadFolders();
        if (autoRefreshMs > 0) { const t = setInterval(loadFolders, autoRefreshMs); return () => clearInterval(t); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [baseUrl, autoRefreshMs]);

    // ---------- folders filtering ----------
    const filteredFolders = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return folders;
        return folders.filter((f) => f.name.toLowerCase().includes(q));
    }, [folders, query]);

    // ---------- folders selection ----------
    const toggleSelect = (url) => setSelected((p) => ({ ...p, [url]: !p[url] }));
    const isAllSelected = filteredFolders.length > 0 && filteredFolders.every((f) => !!selected[f.url]);
    const toggleSelectAll = () => {
        if (isAllSelected) {
            const next = { ...selected }; for (const f of filteredFolders) delete next[f.url]; setSelected(next);
        } else {
            const next = { ...selected }; for (const f of filteredFolders) next[f.url] = true; setSelected(next);
        }
    };
    const allSelectedUrls = folders.filter((f) => selected[f.url]).map((f) => f.url);

    // ---------- photos selection ----------
    const togglePhoto = (url) => setSelectedPhotos((p) => ({ ...p, [url]: !p[url] }));
    const allSelectedPhotoUrls = images.filter(img => selectedPhotos[img.url]).map(img => img.url);
    const areAllPhotosSelected = images.length > 0 && images.every(img => !!selectedPhotos[img.url]);
    const toggleSelectAllPhotos = () => {
        if (areAllPhotosSelected) {
            setSelectedPhotos({});
        } else {
            const next = {}; for (const img of images) next[img.url] = true; setSelectedPhotos(next);
        }
    };

    // ---------- one-folder ZIP ----------
    const downloadZip = async (folder) => {
        try {
            setBusyText('Открываю диалог сохранения…');
            const zipPath = await window.electronAPI.pickZipPath(`${folder.name}.zip`);
            if (!zipPath) { clearBusy(); return; }
            setBusyText('Собираю ZIP…');
            await window.electronAPI.makeZipAll({ folderUrl: folder.url, zipPath });
            clearBusy(); alert(`✅ Saved: ${zipPath}`);
        } catch (e) { clearBusy(); alert(`❌ ${e.message}`); }
    };

    // ---------- MULTI folders -> ONE ZIP ----------
    const downloadSelectedFolders = async () => {
        const picked = folders.filter(f => selected[f.url]);
        if (!picked.length) return;
        if (!hasElectron || !window.electronAPI?.makeZipMulti) { alert('Обновите приложение: main/preload без метода make-zip-multi'); return; }
        const count = picked.length;
        const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0,16);
        const suggested = `AW-folders_${count}_${stamp}.zip`;
        try {
            setBusyText('Открываю диалог сохранения…');
            const zipPath = await window.electronAPI.pickZipPath(suggested);
            if (!zipPath) { clearBusy(); return; }
            setBusyText('Собираю общий ZIP…');
            const entries = picked.map(f => ({ name: f.name, url: f.url }));
            const res = await window.electronAPI.makeZipMulti({ entries, zipPath });
            clearBusy(); if (res?.ok) alert(`✅ Saved: ${zipPath}`); else alert('❌ Не удалось собрать общий ZIP');
        } catch (e) { clearBusy(); alert(`❌ ${e.message}`); }
    };

    // ---------- MULTI photos -> ONE ZIP ----------
    const downloadSelectedPhotos = async () => {
        if (!allSelectedPhotoUrls.length) return;
        if (!window.electronAPI?.makeZipPhotos) { alert('Обновите приложение: нет make-zip-photos'); return; }
        const count = allSelectedPhotoUrls.length;
        const name = currentFolder ? currentFolder.name : 'photos';
        const suggested = `${name}_selected_${count}.zip`;
        try {
            setBusyText('Открываю диалог сохранения…');
            const zipPath = await window.electronAPI.pickZipPath(suggested);
            if (!zipPath) { clearBusy(); return; }
            setBusyText('Собираю ZIP из выделенных фото…');
            const res = await window.electronAPI.makeZipPhotos({ photos: allSelectedPhotoUrls, zipPath, prefix: '' });
            clearBusy(); if (res?.ok) alert(`✅ Saved: ${zipPath}`); else alert('❌ Не удалось собрать ZIP');
        } catch (e) { clearBusy(); alert(`❌ ${e.message}`); }
    };

    // ---------- delete folders ----------
    const deleteSelected = async () => {
        if (!allSelectedUrls.length) return;
        if (!window.confirm(`Удалить ${allSelectedUrls.length} выбранных папок?`)) return;
        setBusyDelete(true); setBusyText('Удаляю выбранные папки…');
        try {
            const res = await window.electronAPI.deleteFoldersRemote(allSelectedUrls);
            if (!res.ok) {
                const bad = (res.results || []).filter(r => !r.ok).map(r => `${r.url} (${r.status || r.error})`);
                alert('Некоторые не удалены:\n' + bad.join('\n'));
            } else alert('✅ Все выбранные папки удалены');
            await loadFolders();
        } catch (e) { alert('Ошибка удаления: ' + e.message); }
        finally { setBusyDelete(false); clearBusy(); }
    };

    // ---------- delete photos ----------
    const deleteSelectedPhotos = async () => {
        if (!allSelectedPhotoUrls.length) return;
        if (!window.confirm(`Удалить ${allSelectedPhotoUrls.length} фото?`)) return;
        setBusyDelete(true); setBusyText('Удаляю выбранные фото…');
        try {
            const res = await window.electronAPI.deleteImagesRemote(allSelectedPhotoUrls);
            if (!res.ok) {
                const bad = (res.results || []).filter(r => !r.ok).map(r => `${r.url} (${r.status || r.error})`);
                alert('Некоторые фото не удалены:\n' + bad.join('\n'));
            } else alert('✅ Фото удалены');
            // перезагрузим список фоток
            if (currentFolder) await loadImages(currentFolder);
            setSelectedPhotos({});
        } catch (e) { alert('Ошибка удаления: ' + e.message); }
        finally { setBusyDelete(false); clearBusy(); }
    };

    const isAnyBusy = busy.active || busyDelete;

    // ===================== RENDER =====================
    if (currentFolder) {
        return (
            <div className={s.wrap} aria-busy={isAnyBusy}>
                {isAnyBusy && (
                    <div className={s.backdrop} role="alert" aria-live="polite">
                        <div className={s.loader} aria-hidden />
                        <div className={s.loaderText}>{busy.text || 'Выполняется…'}</div>
                        <div className={s.loaderSub}>Если окно «Сохранить файл» не видно — проверьте панель задач.</div>
                    </div>
                )}

                <div className={s.header}>
                    <div className={s.left}>
                        <button className={s.btn} onClick={loadFolders} disabled={isAnyBusy}>← Back</button>
                        <h3 className={s.title}>Photos in {currentFolder.name}</h3>
                    </div>
                    <div className={s.right}>
                        <button className={s.btn} onClick={toggleSelectAllPhotos} disabled={isAnyBusy || images.length === 0}>
                            {areAllPhotosSelected ? `Unselect (${allSelectedPhotoUrls.length}) Image` : `Select all Image(${allSelectedPhotoUrls.length})`}
                        </button>
                        <button className={s.btnPrimary} onClick={downloadSelectedPhotos} disabled={isAnyBusy || !allSelectedPhotoUrls.length}>
                            {busy.active
                                ? <span className={s.btnSpinnerWrap}><span className={s.btnSpinner} /> <span>Preparing…</span></span>
                                : `Download selected (${allSelectedPhotoUrls.length}) Image`}
                        </button>
                        {allSelectedPhotoUrls.length > 0 && (
                            <button className={s.btnDanger} onClick={deleteSelectedPhotos} disabled={busyDelete || busy.active}>
                                {busyDelete
                                    ? <span className={s.btnSpinnerWrap}><span className={s.btnSpinner} /> <span>deleting…</span></span>
                                    : `delete (${allSelectedPhotoUrls.length}) Image`}
                            </button>
                        )}
                    </div>

                </div>

                {err && <div className={s.error}>⚠ {err}</div>}
                {loading && <div className={s.loading}>Loading...</div>}

                <div className={s.gridPhotos}>
                    {images.map((img) => (
                        <div key={img.url} className={`${s.photoItem} ${selectedPhotos[img.url] ? s.selected : ''}`}>
                            <div className={s.checkbox} onClick={(e) => e.stopPropagation()}>
                                <input
                                    type="checkbox"
                                    checked={!!selectedPhotos[img.url]}
                                    onChange={() => togglePhoto(img.url)}
                                    disabled={isAnyBusy}
                                />
                            </div>
                            {/* кликом по превью можно открыть в новой вкладке */}
                            <a href={img.url} target="_blank" rel="noreferrer" title={img.name}>
                                <img src={img.url} alt={img.name} className={s.photoThumb} />
                            </a>
                            <div className={s.photoName}>{img.name}</div>
                            {/* !!! per-photo Download удалён по твоей просьбе */}
                        </div>
                    ))}
                    {!loading && !err && images.length === 0 && (<div className={s.empty}>No images in this folder</div>)}
                </div>
            </div>
        );
    }

    // ---------- список папок ----------
    return (
        <div className={s.wrap} aria-busy={isAnyBusy}>
            {isAnyBusy && (
                <div className={s.backdrop} role="alert" aria-live="polite">
                    <div className={s.loader} aria-hidden />
                    <div className={s.loaderText}>{busy.text || 'Выполняется…'}</div>
                    <div className={s.loaderSub}>Если окно «Сохранить файл» не видно — проверьте панель задач.</div>
                </div>
            )}

            <div className={s.header}>
                <div className={s.left}>
                    <div className={s.controls}>
                        <input className={s.input} placeholder="Search folders…" value={query} onChange={(e) => setQuery(e.target.value)} disabled={isAnyBusy}/>
                        <button className={s.btn} onClick={loadFolders} disabled={loading || isAnyBusy}>
                            {loading ? 'Refreshing…' : 'Refresh'}
                        </button>
                        <button className={s.btn} onClick={toggleSelectAll} disabled={isAnyBusy || filteredFolders.length === 0}>
                            {isAllSelected ? `Unselect all (${filteredFolders.length} Folder)` : `Select all (${allSelectedUrls.length} Folder)`}
                        </button>
                        <button className={s.btnPrimary} onClick={downloadSelectedFolders} disabled={isAnyBusy || !allSelectedUrls.length || !hasElectron}>
                            {busy.active
                                ? <span className={s.btnSpinnerWrap}><span className={s.btnSpinner} /> <span>Preparing…</span></span>
                                : `Download selected (${allSelectedUrls.length} Folder)`}
                        </button>
                        {allSelectedUrls.length > 0 && (
                            <button className={s.btnDanger} onClick={deleteSelected} disabled={busyDelete || busy.active}>
                                {busyDelete
                                    ? <span className={s.btnSpinnerWrap}><span className={s.btnSpinner} /> <span>deleting…</span></span>
                                    : `delete (${allSelectedUrls.length} Folder)`}
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
                        onClick={() => !isAnyBusy && loadImages(f)}
                        aria-disabled={isAnyBusy}
                    >
                        <div className={s.checkbox} onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={!!selected[f.url]} onChange={() => toggleSelect(f.url)} disabled={isAnyBusy}/>
                        </div>
                        <span className={s.icon} aria-hidden></span>
                        <span className={s.name}>{f.name}</span>
                    </div>
                ))}
                {!loading && !err && filteredFolders.length === 0 && (<div className={s.empty}>No folders</div>)}
            </div>
        </div>
    );
}
