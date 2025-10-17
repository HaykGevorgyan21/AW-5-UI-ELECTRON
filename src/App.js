
import Home from "./Home/Home";
import  './App.css'
import GetAllImages from "./GetAllImages/GetAllImages";
import FoldersView from "./Components/Folderview";
// import FolderList from "./Components/FolderList";

export default function App() {

    return (<div className='bg'>
        {/*<Home/>*/}
        {/*<FolderList baseUrl="http://192.168.4.1:8000" />*/}

{/*<FoldersView defaultBaseUrl="http://192.168.4.1:8000"  />*/}
        <GetAllImages
            baseUrl="http://192.168.4.1:8000"
            autoRefreshMs={0} // поставь 5000 для авто-обновления каждые 5s
            onOpen={(folder) => {
                // здесь можно открыть папку в твоём уже существующем загрузчике
                console.log('Open folder:', folder);
                // например: setFolderUrl(folder.url)
            }}
        />

    </div>)

}