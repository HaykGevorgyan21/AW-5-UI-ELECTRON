import { useEffect, useState } from 'react';
import s from './GetImages.module.scss';

export default function GetImages({ folder, onBack }) {
    const [images, setImages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            setErr('');
            try {
                const list = await window.electronAPI.listImages(folder.url);
                setImages(list);
            } catch (e) {
                setErr(e.message || String(e));
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [folder]);

    return (
        <div className={s.wrap}>
            <button className={s.back} onClick={onBack}>← Back</button>
            <h3 className={s.title}>Photos in: {folder.name}</h3>
            {err && <div className={s.error}>⚠ {err}</div>}
            {loading && <div className={s.loading}>Loading...</div>}

            <div className={s.grid}>
                {images.map(img => (
                    <a key={img.url} href={img.url} target="_blank" rel="noreferrer" className={s.item}>
                        <img src={img.url} alt={img.name} />
                        <div className={s.name}>{img.name}</div>
                    </a>
                ))}
            </div>
        </div>
    );
}
