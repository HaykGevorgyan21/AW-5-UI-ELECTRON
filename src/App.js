
import Home from "./Home/Home";
import GetAllImages from "./GetAllImages/GetAllImages";

export default function App() {
    return (<>
        <Home/>

        <GetAllImages
            baseUrl="http://192.168.27.34:8000"
            autoRefreshMs={0} // поставь 5000 для авто-обновления каждые 5s
            onOpen={(folder) => {
                // здесь можно открыть папку в твоём уже существующем загрузчике
                console.log('Open folder:', folder);
                // например: setFolderUrl(folder.url)
            }}
        />

    </>)

}