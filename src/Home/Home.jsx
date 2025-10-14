import { useState, useMemo } from 'react';
import s from './Home.module.scss';

export default function Home() {
    const [photoUrl, setPhotoUrl] = useState(
        'http://192.168.4.1:8000/09_October_2025_16-10/DSC01555.JPG'
    );
    const [folderUrl, setFolderUrl] = useState(
        'http://192.168.4.1:8000/09_October_2025_16-10/'
    );
    const [msg, setMsg] = useState('');
    const [showUrl, setShowUrl] = useState('');

    // безопасная проверка наличия Electron API (если вдруг откроешь в браузере)
    const hasElectron = useMemo(
        () => typeof window !== 'undefined' && !!window.electronAPI,
        []
    );

    const loadPhoto = () => {
        const noCache = photoUrl + (photoUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
        setShowUrl(noCache);
    };

    const downloadOne = async () => {
        setMsg('');
        if (!hasElectron) {
            setMsg('⚠️ Запусти через Electron (window.electronAPI не найден)');
            return;
        }
        try {
            const suggested = (photoUrl.split('/').pop()?.replace(/\.[^.]+$/, '') || 'photo') + '_one.zip';
            const zipPath = await window.electronAPI.pickZipPath(suggested);
            if (!zipPath) return;
            const res = await window.electronAPI.makeZipOne({ url: photoUrl, zipPath });
            setMsg(`✅ One photo saved to ${res.zipPath}`);
        } catch (e) {
            setMsg('❌ ' + e.message);
        }
    };

    const downloadAll = async () => {
        setMsg('');
        if (!hasElectron) {
            setMsg('⚠️ Запусти через Electron (window.electronAPI не найден)');
            return;
        }
        try {
            const suggested = (folderUrl.split('/').filter(Boolean).pop() || 'photos') + '_all.zip';
            const zipPath = await window.electronAPI.pickZipPath(suggested);
            if (!zipPath) return;
            const res = await window.electronAPI.makeZipAll({ folderUrl, zipPath });
            setMsg(`✅ All photos (${res.count}) saved to ${res.zipPath}`);
        } catch (e) {
            setMsg('❌ ' + e.message);
        }
    };

    return (
        <div className={s.wrap}>
            <h2 className={s.title}>📸 Photo Downloader</h2>

            <section className={s.card}>
                <h4 className={s.subtitle}>Single photo</h4>
                <div className={s.row}>
                    <input
                        className={s.input}
                        value={photoUrl}
                        onChange={e => setPhotoUrl(e.target.value)}
                        placeholder="Direct URL to image"
                    />
                    <button className={s.btn} onClick={loadPhoto}>Preview</button>
                    <button className={s.btnPrimary} onClick={downloadOne}>Download 1</button>
                </div>

                {showUrl && (
                    <div className={s.previewBox}>
                        <img
                            src={showUrl}
                            alt="preview"
                            className={s.previewImg}
                        />
                    </div>
                )}
            </section>

            <section className={s.card}>
                <h4 className={s.subtitle}>All photos in folder</h4>
                <div className={s.row}>
                    <input
                        className={s.input}
                        value={folderUrl}
                        onChange={e => setFolderUrl(e.target.value)}
                        placeholder="URL of directory with images"
                    />
                    <button className={s.btnPrimary} onClick={downloadAll}>Download All</button>
                </div>
            </section>

            {msg && <div className={s.message}>{msg}</div>}

            {!hasElectron && (
                <div className={s.note}>
                    ℹ️ This page was opened in a regular browser. Run via Electron window so file saving works.
                </div>
            )}
        </div>
    );
}
