// Runs from a private temporary directory so the portable binaries can be replaced.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

class Updater {
    static JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 1048576 };
    static string Temp, Root, Backup, TargetVersion;
    static int ParentPid;
    static List<Change> Changes = new List<Change>();
    class Change { public string path; public bool existed; }
    static Dictionary<string,object> Object(string text) { return Json.Deserialize<Dictionary<string,object>>(text); }
    static string Text(Dictionary<string,object> obj,string key) { return Convert.ToString(obj[key]); }
    static string Hash(string file) { using(var stream=File.OpenRead(file)) using(var sha=SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant(); }
    static void Ensure(bool ok,string message) { if(!ok)throw new InvalidOperationException(message); }
    static bool Allowed(string name) {
        string[] roots={"app.cjs","quality.cjs","browser-downloads.cjs","updates.cjs","version.json","ClipPocket.exe","Updater.exe","Launcher.cs","Updater.cs","使用說明.txt","THIRD_PARTY.md","SOURCE_CODE.md","驗證摘要.md","驗證結果.json","4K片段驗證.json","資料夾視窗驗證.json","瀏覽器儲存驗證.json","更新驗證.json","runtime-manifest.json"};
        return roots.Contains(name,StringComparer.OrdinalIgnoreCase)
          ||Regex.IsMatch(name,@"^bin/(node\.exe|yt-dlp\.exe|ffmpeg/[a-zA-Z0-9_.-]+\.(exe|dll))$")
          ||Regex.IsMatch(name,@"^licenses/[a-zA-Z0-9_.-]+$")
          ||new[]{"ui/index.html","ui/ui.js","ui/style.css","compat/clippocket/yt_dlp_plugins/extractor/bilibili_compat.py"}.Contains(name,StringComparer.OrdinalIgnoreCase);
    }
    static string Safe(string root,string relative) {
        Ensure(relative.Length<200&&!relative.Contains('\\')&&!relative.Contains(':')&&!relative.StartsWith("/")&&!relative.Split('/').Any(x=>x=="."||x==".."||x.Length==0||x.EndsWith(".")||x.EndsWith(" ")),"Unsafe update path");
        string full=Path.GetFullPath(Path.Combine(root,relative.Replace('/',Path.DirectorySeparatorChar)));
        Ensure(full.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase),"Update path escaped its folder");
        string current=full;
        while(current.Length>root.Length){if(File.Exists(current)||Directory.Exists(current))Ensure((File.GetAttributes(current)&FileAttributes.ReparsePoint)==0,"Update target contains a link: "+relative);current=Path.GetDirectoryName(current);}
        return full;
    }
    static Dictionary<string,Dictionary<string,object>> Manifest(string file,string version) {
        var manifest=Object(File.ReadAllText(file,Encoding.UTF8));
        Ensure(Text(manifest,"application")=="ClipPocket"&&Text(manifest,"platform")=="windows-x64"&&Text(manifest,"version")==version,"Update manifest version mismatch");
        var result=new Dictionary<string,Dictionary<string,object>>(StringComparer.OrdinalIgnoreCase);
        foreach(var item in (System.Collections.IEnumerable)manifest["files"]){var entry=(Dictionary<string,object>)item;string name=Text(entry,"path");Ensure(Allowed(name)&&name!="runtime-manifest.json"&&!result.ContainsKey(name),"Invalid or duplicate managed file: "+name);Safe(Root,name);Ensure(Regex.IsMatch(Text(entry,"sha256"),"^[a-f0-9]{64}$")&&Convert.ToInt64(entry["bytes"])>=0,"Invalid file digest");result.Add(name,entry);}
        Ensure(result.Count>=10&&result.Count<=150,"Invalid manifest file count");
        foreach(string name in new[]{"app.cjs","version.json","ClipPocket.exe","Updater.exe","updates.cjs","bin/node.exe","bin/yt-dlp.exe","bin/ffmpeg/ffmpeg.exe","ui/index.html"})Ensure(result.ContainsKey(name),"Missing required file: "+name);
        return result;
    }
    static Dictionary<string,Dictionary<string,object>> Prepare(Dictionary<string,object> plan) {
        string archive=Path.Combine(Temp,"package.zip"),stage=Path.Combine(Temp,"payload");
        Ensure(new FileInfo(archive).Length==Convert.ToInt64(plan["bytes"])&&Hash(archive)==Text(plan,"sha256"),"ZIP checksum mismatch");
        Directory.CreateDirectory(stage);var names=new HashSet<string>(StringComparer.OrdinalIgnoreCase);long expanded=0;
        using(var zip=ZipFile.OpenRead(archive)){
            Ensure(zip.Entries.Count<=200,"Too many ZIP entries");
            foreach(var entry in zip.Entries){
                string raw=entry.FullName;
                Ensure(raw.StartsWith("ClipPocket/",StringComparison.Ordinal)&&!raw.Contains('\\'),"Unexpected ZIP root");
                if(raw=="ClipPocket/")continue;
                string relative=raw.Substring(11).TrimEnd('/');Safe(stage,relative);
                Ensure(((entry.ExternalAttributes>>16)&0xF000)!=0xA000&&(entry.ExternalAttributes&0x400)==0,"ZIP links are not allowed");
                if(raw.EndsWith("/"))continue;
                Ensure(Allowed(relative)&&names.Add(relative),"Unmanaged or duplicate ZIP entry: "+relative);
                expanded+=entry.Length;Ensure(expanded<=1024L*1024*1024,"Expanded update is too large");
            }
            // Validation above finishes before a single entry is extracted.
            foreach(var entry in zip.Entries){if(entry.FullName.EndsWith("/"))continue;string relative=entry.FullName.Substring(11),dest=Safe(stage,relative);Directory.CreateDirectory(Path.GetDirectoryName(dest));entry.ExtractToFile(dest,false);}
        }
        var files=Manifest(Path.Combine(stage,"runtime-manifest.json"),TargetVersion);
        Ensure(names.SetEquals(files.Keys.Concat(new[]{"runtime-manifest.json"})),"ZIP files differ from manifest");
        foreach(var pair in files){string file=Safe(stage,pair.Key);Ensure(new FileInfo(file).Length==Convert.ToInt64(pair.Value["bytes"])&&Hash(file)==Text(pair.Value,"sha256"),"Packaged file checksum mismatch: "+pair.Key);}
        var version=Object(File.ReadAllText(Path.Combine(stage,"version.json"),Encoding.UTF8));Ensure(Text(version,"version")==TargetVersion&&Text(version,"name")=="ClipPocket"&&Text(version,"platform")=="windows-x64","Packaged application version mismatch");
        return files;
    }
    static void Retry(Action action){for(int i=0;;i++){try{action();return;}catch(IOException){if(i>=20)throw;Thread.Sleep(250);}catch(UnauthorizedAccessException){if(i>=20)throw;Thread.Sleep(250);}}}
    static void AtomicCopy(string source,string destination) {
        Directory.CreateDirectory(Path.GetDirectoryName(destination));string temporary=destination+".update-"+Guid.NewGuid().ToString("N");
        try{File.Copy(source,temporary,false);Retry(()=>{if(File.Exists(destination))File.Replace(temporary,destination,null);else File.Move(temporary,destination);});}finally{if(File.Exists(temporary))File.Delete(temporary);}
    }
    static void Record(string name) {
        string dest=Safe(Root,name),saved=Safe(Backup,name);bool exists=File.Exists(dest);
        if(exists){Directory.CreateDirectory(Path.GetDirectoryName(saved));File.Copy(dest,saved,false);}
        Changes.Add(new Change { path=name,existed=exists });
        File.WriteAllText(Path.Combine(Backup,"journal.json"),Json.Serialize(Changes),Encoding.UTF8);
    }
    static void Apply(Dictionary<string,Dictionary<string,object>> files) {
        string stage=Path.Combine(Temp,"payload");
        var managed=new HashSet<string>(files.Keys,StringComparer.OrdinalIgnoreCase);managed.Add("runtime-manifest.json");
        // Only remove obsolete files that the previous package explicitly owned.
        var old=Object(File.ReadAllText(Path.Combine(Root,"runtime-manifest.json"),Encoding.UTF8));
        var oldNames=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach(var item in (System.Collections.IEnumerable)old["files"])oldNames.Add(Text((Dictionary<string,object>)item,"path"));
        foreach(string name in managed)Ensure(name=="runtime-manifest.json"||oldNames.Contains(name)||(!File.Exists(Safe(Root,name))&&!Directory.Exists(Safe(Root,name))),"A user file conflicts with the update: "+name);
        foreach(var item in (System.Collections.IEnumerable)old["files"]){string name=Text((Dictionary<string,object>)item,"path");Ensure(Allowed(name),"Invalid previous manifest");if(!managed.Contains(name)&&File.Exists(Safe(Root,name))){Record(name);Retry(()=>File.Delete(Safe(Root,name)));}}
        foreach(string name in managed){if(name!="runtime-manifest.json"&&File.Exists(Safe(Root,name))&&Hash(Safe(Root,name))==Text(files[name],"sha256"))continue;Record(name);AtomicCopy(Safe(stage,name),Safe(Root,name));}
    }
    static void Rollback() {
        for(int i=Changes.Count-1;i>=0;i--){var change=Changes[i];string dest=Safe(Root,change.path);if(change.existed)AtomicCopy(Safe(Backup,change.path),dest);else Retry(()=>{if(File.Exists(dest))File.Delete(dest);});}
    }
    static int InstancePid() {try{return Convert.ToInt32(Object(File.ReadAllText(Path.Combine(Root,".instance.json")))["pid"]);}catch{return 0;}}
    static bool Healthy(string version) {
        try{var instance=Object(File.ReadAllText(Path.Combine(Root,".instance.json")));if(Convert.ToInt32(instance["pid"])==ParentPid)return false;int port=Convert.ToInt32(instance["port"]);Ensure(port>0&&port<65536,"Invalid port");
            var request=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:"+port+"/health");request.Proxy=null;request.Timeout=1500;
            using(var response=request.GetResponse())using(var reader=new StreamReader(response.GetResponseStream())){var health=Object(reader.ReadToEnd());return Text(health,"app")=="ClipPocket"&&Text(health,"version")==version;}
        }catch{return false;}
    }
    static void StartApp(){var start=new ProcessStartInfo(Path.Combine(Root,"ClipPocket.exe"));start.WorkingDirectory=Root;start.UseShellExecute=false;start.CreateNoWindow=true;Process.Start(start);}
    static void StopNewApp(){int pid=InstancePid();if(pid==0||pid==ParentPid)return;try{var proc=Process.GetProcessById(pid);if(String.Equals(proc.MainModule.FileName,Path.Combine(Root,"bin","node.exe"),StringComparison.OrdinalIgnoreCase)){proc.Kill();proc.WaitForExit(10000);}}catch{}}
    static void Result(string status,string message){File.WriteAllText(Path.Combine(Root,"data","update-result.json"),Json.Serialize(new{status=status,message=message,version=TargetVersion,at=DateTime.UtcNow.ToString("o")}),Encoding.UTF8);}
    [STAThread] static void Main(string[] args) {
        FileStream updateLock=null;bool departed=false,changed=false,restored=false;string oldVersion=null;
        try{
            Ensure(args.Length==1,"Expected an update plan");Temp=AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            Ensure(Path.GetFullPath(args[0])==Path.Combine(Temp,"plan.json"),"Plan must be beside updater");
            var plan=Object(File.ReadAllText(args[0]));Root=Path.GetFullPath(Text(plan,"root")).TrimEnd(Path.DirectorySeparatorChar);ParentPid=Convert.ToInt32(plan["parentPid"]);TargetVersion=Text(plan,"version");
            Ensure(Regex.IsMatch(TargetVersion,@"^\d{1,6}\.\d{1,6}\.\d{1,6}$")&&Root!=Temp,"Invalid target");
            Ensure(File.Exists(Path.Combine(Root,"app.cjs"))&&File.Exists(Path.Combine(Root,"ClipPocket.exe")),"Portable installation missing");
            Safe(Root,"data/update.lock");Directory.CreateDirectory(Path.Combine(Root,"data"));
            updateLock=new FileStream(Path.Combine(Root,"data","update.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);
            oldVersion=Text(Object(File.ReadAllText(Path.Combine(Root,"version.json"))),"version");
            Ensure(new Version(TargetVersion)>new Version(oldVersion),"Refusing an equal or older version");
            Process parent=Process.GetProcessById(ParentPid);
            Ensure(String.Equals(parent.MainModule.FileName,Path.Combine(Root,"bin","node.exe"),StringComparison.OrdinalIgnoreCase)&&Math.Abs((parent.StartTime.ToUniversalTime()-new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds-Convert.ToDouble(plan["parentStarted"]))<5000,"Update parent process does not match");
            var files=Prepare(plan);File.WriteAllText(Path.Combine(Temp,"ready"),"");
            DateTime limit=DateTime.UtcNow.AddSeconds(30);while(!File.Exists(Path.Combine(Temp,"go"))){Ensure(DateTime.UtcNow<limit,"Update handoff expired");Thread.Sleep(100);}
            Ensure(parent.WaitForExit(60000),"Please close the running application before updating");departed=true;
            Backup=Safe(Root,"data/update-backups/"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Backup);
            changed=true;Apply(files);updateLock.Dispose();updateLock=null;StartApp();
            limit=DateTime.UtcNow.AddSeconds(60);while(!Healthy(TargetVersion)){Ensure(DateTime.UtcNow<limit,"New version did not start correctly");Thread.Sleep(300);}
            Result("updated","已更新至 v"+TargetVersion+"，設定與下載檔案已保留。");restored=true;
            try{Directory.Delete(Backup,true);}catch{} // Cleanup failure must never roll back a healthy update.
        }catch(Exception error){
            string message=error.Message;
            if(departed){try{StopNewApp();if(changed)Rollback();restored=true;Result("rolled-back","更新未完成，已還原原版本："+message);if(updateLock!=null){updateLock.Dispose();updateLock=null;}StartApp();}catch(Exception rollback){message+="\n還原未完成，備份保留在："+Backup+"\n"+rollback.Message;try{Result("recovery-required",message);}catch{}MessageBox.Show(message,"ClipPocket 更新",MessageBoxButtons.OK,MessageBoxIcon.Error);}}
            if(Temp!=null)try{File.WriteAllText(Path.Combine(Temp,"failed.txt"),message,Encoding.UTF8);}catch{}
        }finally{
            if(updateLock!=null)updateLock.Dispose();
            if(Temp!=null){try{File.Delete(Path.Combine(Temp,"package.zip"));if(Directory.Exists(Path.Combine(Temp,"payload")))Directory.Delete(Path.Combine(Temp,"payload"),true);File.WriteAllText(Path.Combine(Temp,"completed"),DateTime.UtcNow.ToString("o"));}catch{}}
            if(restored&&Backup!=null)try{if(Directory.Exists(Backup))Directory.Delete(Backup,true);}catch{}
        }
    }
}
