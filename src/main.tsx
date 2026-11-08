import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { prepareTileArt } from './table/tileArt';
import './styles.css';
import './themes.css';
import './effects/effects.css';
import './table/tableUI.css';
import './mobile.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);
void prepareTileArt().then(() => {
  root.render(<React.StrictMode><App /></React.StrictMode>);
}).catch(() => {
  root.render(<div className="webgl-fallback"><strong>牌面资源未能载入</strong><p>请保留完整游戏文件夹后重新打开。</p><button onClick={() => location.reload()}>重新载入</button></div>);
});
