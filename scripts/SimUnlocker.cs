using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public class SimUnlocker {
    [DllImport("ntdll.dll")] public static extern int NtQueryObject(IntPtr Handle, int ObjectInformationClass, IntPtr ObjectInformation, int ObjectInformationLength, out int ReturnLength);
    [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);
    [DllImport("kernel32.dll")] public static extern bool DuplicateHandle(IntPtr hSourceProcessHandle, IntPtr hSourceHandle, IntPtr hTargetProcessHandle, out IntPtr lpTargetHandle, uint dwDesiredAccess, bool bInheritHandle, uint dwOptions);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr hObject);

    public static bool Unlock(int pid) {
        IntPtr hProc = OpenProcess(0x1F0FFF, false, pid);
        if (hProc == IntPtr.Zero) return false;
        bool unlocked = false;
        for (int h = 4; h < 0x2000; h += 4) {
            IntPtr dup;
            if (DuplicateHandle(hProc, (IntPtr)h, Process.GetCurrentProcess().Handle, out dup, 0, false, 2)) {
                IntPtr typeBuf = Marshal.AllocHGlobal(256);
                int ret;
                if (NtQueryObject(dup, 2, typeBuf, 256, out ret) == 0) {
                    short len = Marshal.ReadInt16(typeBuf);
                    IntPtr strPtr = Marshal.ReadIntPtr(new IntPtr(typeBuf.ToInt64() + (IntPtr.Size == 8 ? 8 : 4)));
                    if (strPtr != IntPtr.Zero && len > 0) {
                        string typeName = Marshal.PtrToStringUni(strPtr, len / 2);
                        if (typeName == "Mutant") {
                            IntPtr nameBuf = Marshal.AllocHGlobal(512);
                            if (NtQueryObject(dup, 1, nameBuf, 512, out ret) == 0) {
                                short nlen = Marshal.ReadInt16(nameBuf);
                                IntPtr nptr = Marshal.ReadIntPtr(new IntPtr(nameBuf.ToInt64() + (IntPtr.Size == 8 ? 8 : 4)));
                                if (nptr != IntPtr.Zero && nlen > 0) {
                                    string objName = Marshal.PtrToStringUni(nptr, nlen / 2);
                                    if (objName.IndexOf("Sim-", StringComparison.OrdinalIgnoreCase) >= 0) {
                                        CloseHandle(dup);
                                        Marshal.FreeHGlobal(nameBuf);
                                        Marshal.FreeHGlobal(typeBuf);
                                        IntPtr targetDup;
                                        DuplicateHandle(hProc, (IntPtr)h, Process.GetCurrentProcess().Handle, out targetDup, 0, false, 1);
                                        CloseHandle(targetDup);
                                        unlocked = true;
                                        break;
                                    }
                                }
                            }
                            Marshal.FreeHGlobal(nameBuf);
                        }
                    }
                }
                Marshal.FreeHGlobal(typeBuf);
                CloseHandle(dup);
            }
        }
        CloseHandle(hProc);
        return unlocked;
    }
}