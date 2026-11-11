import { useEffect, useRef, useState } from 'react';
import type { SavedGame } from '../game/types';
import { exportFullBackup, FullBackupRestoreError, MAX_FULL_BACKUP_BYTES, parseFullBackup, restoreFullBackup } from '../records/backup';
import { ExperienceDialog } from './ExperienceDialog';
import './dataBackup.css';

interface BackupControlsProps {
  prepareExport: () => { savedGame?: SavedGame | null; preferences?: unknown };
  onRestored: () => void;
  onRecoveryRequired: (backupText: string) => void;
}

function downloadBackup(text: string, recovery = false) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `雀境-${recovery ? '恢复副本' : '完整备份'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DataBackupControls({ prepareExport, onRestored, onRecoveryRequired }: BackupControlsProps) {
  const file = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const [candidate, setCandidate] = useState<ReturnType<typeof parseFullBackup> | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => () => { request.current++; }, []);

  function exportData() {
    try {
      downloadBackup(exportFullBackup(prepareExport()));
      setNotice('完整备份已导出。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '备份导出失败。');
    }
  }

  async function selectFile(selected?: File) {
    if (!selected) return;
    const current = ++request.current;
    setCandidate(null);
    setNotice('');
    if (selected.size > MAX_FULL_BACKUP_BYTES) {
      setNotice('备份文件过大，请选择雀境导出的完整备份。');
      if (file.current) file.current.value = '';
      return;
    }
    setBusy(true);
    try {
      const parsed = parseFullBackup(await selected.text());
      if (current === request.current) setCandidate(parsed);
    } catch (error) {
      if (current === request.current) setNotice(error instanceof Error ? error.message : '无法读取备份。');
    } finally {
      if (current === request.current) setBusy(false);
      if (file.current) file.current.value = '';
    }
  }

  function restoreData() {
    if (!candidate) return;
    let currentBackup: string | undefined;
    try { currentBackup = exportFullBackup(prepareExport()); } catch { /* The transaction also captures its own recovery copy. */ }
    try {
      restoreFullBackup(candidate.backup);
    } catch (error) {
      if (error instanceof FullBackupRestoreError && error.persistencePaused) {
        // Fatal rollback errors always include the original recovery document.
        onRecoveryRequired(currentBackup ?? error.recoveryBackupText!);
      } else setNotice(error instanceof Error ? error.message : '恢复失败，原数据已保留。');
      return;
    }
    setCandidate(null);
    onRestored();
  }

  return <section className="data-backup" aria-label="完整数据备份">
    <h3>数据备份</h3>
    <div className="data-backup-actions"><button type="button" disabled={busy} onClick={exportData}>备份全部数据</button><button type="button" disabled={busy} onClick={() => file.current?.click()}>{busy ? '正在读取…' : '恢复备份'}</button></div>
    <input ref={file} type="file" className="data-backup-file" accept="application/json,.json" aria-label="选择雀境完整备份" onChange={event => { void selectFile(event.target.files?.[0]); }} />
    {notice && <p role="status">{notice}</p>}
    {candidate && <div className="data-backup-confirm">
      <strong>恢复这份备份？</strong>
      <dl><div><dt>备份时间</dt><dd>{new Date(candidate.summary.createdAt).toLocaleString('zh-CN')}</dd></div><div><dt>牌谱</dt><dd>{candidate.summary.recordCount} 场 · 收藏 {candidate.summary.favoriteCount} 场</dd></div><div><dt>累计战绩</dt><dd>{candidate.summary.settledHands} 局</dd></div><div><dt>当前对局</dt><dd>{candidate.summary.hasCurrentGame ? '包含' : '无'}</dd></div><div><dt>游戏设置</dt><dd>{candidate.summary.hasPreferences ? '包含' : '无'}</dd></div></dl>
      <p>恢复会替换本机的对局、设置、牌谱和战绩，然后重新加载游戏。</p>
      <div className="data-backup-actions"><button className="data-backup-primary" type="button" onClick={restoreData}>恢复并重载</button><button type="button" onClick={() => setCandidate(null)}>取消</button></div>
    </div>}
  </section>;
}

export function DataRecoveryDialog({ backupText, onRestored }: { backupText: string; onRestored: () => void }) {
  const [notice, setNotice] = useState('');
  function retry() {
    try { restoreFullBackup(parseFullBackup(backupText).backup); }
    catch (error) { setNotice(error instanceof Error ? error.message : '原数据仍未能写回，请先下载恢复副本。'); return; }
    onRestored();
  }
  return <div className="data-recovery-dialog"><ExperienceDialog title="数据恢复需要处理" onClose={() => {}} dismissible={false}>
    <div className="data-recovery-content"><p>本地写入与回滚都未完成。游戏已暂停保存，请下载原数据的完整副本，或重试恢复原数据。</p><div className="data-backup-actions"><button type="button" onClick={() => downloadBackup(backupText, true)}>下载恢复副本</button><button type="button" onClick={retry}>重试恢复原数据</button></div>{notice && <p role="alert">{notice}</p>}</div>
  </ExperienceDialog></div>;
}
