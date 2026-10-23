using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
class Launcher {
    [STAThread]
    static void Main() {
        string folder=AppDomain.CurrentDomain.BaseDirectory;
        string node=Path.Combine(folder,"bin","node.exe");
        string app=Path.Combine(folder,"app.cjs");
        if(!File.Exists(node)||!File.Exists(app)) {
            MessageBox.Show("請先完整解壓縮整個 ClipPocket 資料夾，再雙擊 ClipPocket.exe。", "ClipPocket", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        try {
            string lockPath=Path.Combine(folder,"data","update.lock");
            if(File.Exists(lockPath)) {
                try { using(var updateLock=new FileStream(lockPath,FileMode.Open,FileAccess.ReadWrite,FileShare.None)) {} }
                catch(IOException) { MessageBox.Show("ClipPocket 正在更新，完成後會自動重開。","ClipPocket",MessageBoxButtons.OK,MessageBoxIcon.Information);return; }
            }
            ProcessStartInfo start=new ProcessStartInfo(node,"\""+app+"\"");
            start.WorkingDirectory=folder;
            start.UseShellExecute=false;
            start.CreateNoWindow=true;
            start.WindowStyle=ProcessWindowStyle.Hidden;
            Process.Start(start);
        } catch(Exception error) {
            MessageBox.Show("無法啟動工具："+error.Message,"ClipPocket",MessageBoxButtons.OK,MessageBoxIcon.Error);
        }
    }
}
