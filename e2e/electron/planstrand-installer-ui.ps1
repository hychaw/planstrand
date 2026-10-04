# Exercise the actual NSIS destination page using native control messages.
# This is a disposable installer regression, never a user's installation.
function Invoke-PlanstrandInstallerUI([string]$Installer, [string]$Destination) {
  if (!('PlanstrandInstallerControls' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class PlanstrandInstallerControls {
  public delegate bool Callback(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, Callback callback, IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
  public static IntPtr Find(int pid, int id, string cls, string text=null) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((top,p) => {
      uint owner; GetWindowThreadProcessId(top,out owner);
      if(owner != pid) return true;
      EnumChildWindows(top,(h,q)=> {
        var name=new StringBuilder(64); GetClassName(h,name,64);
        if(GetDlgCtrlID(h)==id && name.ToString()==cls && IsWindowVisible(h) && IsWindowEnabled(h) && (text==null || Text(h)==text)) found=h;
        return found==IntPtr.Zero;
      },IntPtr.Zero);
      return found==IntPtr.Zero;
    },IntPtr.Zero);
    return found;
  }
  public static void SetPath(IntPtr h,string path) {
    var text=Marshal.StringToHGlobalUni(path);
    try { IntPtr result; if(SendMessageTimeout(h,0xC,IntPtr.Zero,text,2,1000,out result)==IntPtr.Zero) throw new Exception("Cannot set destination"); }
    finally { Marshal.FreeHGlobal(text); }
  }
  public static string Text(IntPtr h) {
    var buffer=Marshal.AllocHGlobal(4096);
    try { IntPtr result; SendMessageTimeout(h,0xD,(IntPtr)2048,buffer,2,1000,out result); return Marshal.PtrToStringUni(buffer) ?? ""; }
    finally { Marshal.FreeHGlobal(buffer); }
  }
  public static void Click(IntPtr h) { IntPtr result; SendMessageTimeout(h,0xF5,IntPtr.Zero,IntPtr.Zero,2,1000,out result); }
}
'@
  }
  $process = Start-Process -FilePath $Installer -ArgumentList '/currentuser' -PassThru -WindowStyle Hidden
  $selected = $false
  $deadline = [DateTime]::UtcNow.AddSeconds(120)
  while (!$process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
    $directory = [PlanstrandInstallerControls]::Find($process.Id, 1019, 'Edit')
    if ($directory -ne [IntPtr]::Zero -and !$selected) {
      # Let NSIS finish initializing the page before changing its edit control.
      Start-Sleep -Milliseconds 500
      [PlanstrandInstallerControls]::SetPath($directory, $Destination)
      Start-Sleep -Milliseconds 300
      Write-Host "Destination selected: $([PlanstrandInstallerControls]::Text($directory))"
      $selected = $true
    }
    # Match the refusal's OK explicitly; never click the owner's Cancel button.
    $ok = [PlanstrandInstallerControls]::Find($process.Id, 2, 'Button', 'OK')
    if ($ok -ne [IntPtr]::Zero) {
      [PlanstrandInstallerControls]::Click($ok)
      Start-Sleep -Milliseconds 150
      $process.Refresh()
      continue
    }
    $next = [PlanstrandInstallerControls]::Find($process.Id, 1, 'Button')
    if ($next -ne [IntPtr]::Zero) {
      [PlanstrandInstallerControls]::Click($next)
    }
    Start-Sleep -Milliseconds 150
    $process.Refresh()
  }
  if (!$process.HasExited) { throw 'Installer destination UI timed out' }
  if (!$selected) { throw 'Installer never exposed its destination selection page' }
  return $process.ExitCode
}
