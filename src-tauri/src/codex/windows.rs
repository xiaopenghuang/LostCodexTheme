//! Narrow RAII wrappers around Win32. Handles, not saved PIDs, authorize cleanup.
use super::error::{Error, Result};
use std::collections::{HashMap, HashSet};
use std::{
    ffi::OsStr,
    mem::{size_of, zeroed},
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    os::windows::ffi::OsStrExt,
    path::PathBuf,
    ptr::{null, null_mut},
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::*,
    NetworkManagement::IpHelper::*,
    Networking::WinSock::{AF_INET, AF_INET6},
    Storage::Packaging::Appx::GetPackageFullName,
    System::{Diagnostics::ToolHelp::*, JobObjects::*, Threading::*},
};

#[repr(C)]
struct CommandLineInformation {
    length: u16,
    maximum_length: u16,
    buffer: *const u16,
}

#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtQueryInformationProcess(
        process: HANDLE,
        information_class: u32,
        information: *mut std::ffi::c_void,
        information_length: u32,
        return_length: *mut u32,
    ) -> i32;
}

pub(super) struct Handle(pub HANDLE);
pub(super) struct Apartment(bool);
impl Apartment {
    pub fn enter() -> Result<Self> {
        let result = unsafe {
            windows::Win32::System::Com::CoInitializeEx(
                None,
                windows::Win32::System::Com::COINIT_MULTITHREADED,
            )
        };
        if result.0 == 0x80010106u32 as i32 {
            return Ok(Self(false));
        } // An existing STA is also usable.
        result.ok()?;
        Ok(Self(true))
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        if self.0 {
            unsafe {
                windows::Win32::System::Com::CoUninitialize();
            }
        }
    }
}
impl Handle {
    pub fn new(raw: HANDLE) -> Result<Self> {
        if raw.is_null() || raw == INVALID_HANDLE_VALUE {
            Err(std::io::Error::last_os_error().into())
        } else {
            Ok(Self(raw))
        }
    }
}
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

fn check(ok: i32) -> Result<()> {
    if ok == 0 {
        Err(std::io::Error::last_os_error().into())
    } else {
        Ok(())
    }
}

pub(super) fn wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(Some(0)).collect()
}

pub(super) fn open_process(pid: u32) -> Result<Handle> {
    Handle::new(unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
            0,
            pid,
        )
    })
}

pub(super) fn open_managed_process(pid: u32) -> Result<Handle> {
    Handle::new(unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION
                | PROCESS_SYNCHRONIZE
                | PROCESS_SET_QUOTA
                | PROCESS_TERMINATE,
            0,
            pid,
        )
    })
}

pub(super) fn creation_time(process: &Handle) -> Result<u64> {
    let mut created: FILETIME = unsafe { zeroed() };
    let mut exited: FILETIME = unsafe { zeroed() };
    let mut kernel: FILETIME = unsafe { zeroed() };
    let mut user: FILETIME = unsafe { zeroed() };
    check(unsafe {
        GetProcessTimes(process.0, &mut created, &mut exited, &mut kernel, &mut user)
    })?;
    Ok((u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime))
}

pub(super) fn current_file_time() -> u64 {
    let mut now: FILETIME = unsafe { zeroed() };
    unsafe {
        windows_sys::Win32::System::SystemInformation::GetSystemTimeAsFileTime(&mut now);
    }
    (u64::from(now.dwHighDateTime) << 32) | u64::from(now.dwLowDateTime)
}

pub(super) fn command_arguments(process: &Handle) -> Result<Vec<String>> {
    const PROCESS_COMMAND_LINE_INFORMATION: u32 = 60;
    let mut size = 0;
    unsafe {
        NtQueryInformationProcess(
            process.0,
            PROCESS_COMMAND_LINE_INFORMATION,
            null_mut(),
            0,
            &mut size,
        );
    }
    if !(size_of::<CommandLineInformation>() as u32..=128 * 1024).contains(&size) {
        return Err(Error::Safety("process command line is unavailable".into()));
    }
    let mut storage = vec![0usize; (size as usize).div_ceil(size_of::<usize>())];
    let capacity = (storage.len() * size_of::<usize>()) as u32;
    let result = unsafe {
        NtQueryInformationProcess(
            process.0,
            PROCESS_COMMAND_LINE_INFORMATION,
            storage.as_mut_ptr().cast(),
            capacity,
            &mut size,
        )
    };
    if result < 0 || size > capacity {
        return Err(Error::Safety("process command line query failed".into()));
    }
    let info = unsafe {
        storage
            .as_ptr()
            .cast::<CommandLineInformation>()
            .read_unaligned()
    };
    let start = storage.as_ptr() as usize;
    let data = info.buffer as usize;
    let end = data
        .checked_add(usize::from(info.length))
        .ok_or_else(|| Error::Safety("invalid process command line buffer".into()))?;
    if info.length % 2 != 0
        || info.length > info.maximum_length
        || data < start
        || end > start + capacity as usize
        || !data.is_multiple_of(2)
    {
        return Err(Error::Safety("invalid process command line buffer".into()));
    }
    let words = unsafe { std::slice::from_raw_parts(info.buffer, usize::from(info.length) / 2) };
    if words.contains(&0) {
        return Err(Error::Safety(
            "embedded null in process command line".into(),
        ));
    }
    let mut terminated = words.to_vec();
    terminated.push(0);
    let mut count = 0;
    let arguments = unsafe {
        windows_sys::Win32::UI::Shell::CommandLineToArgvW(terminated.as_ptr(), &mut count)
    };
    if arguments.is_null() {
        return Err(std::io::Error::last_os_error().into());
    }
    struct Arguments(*mut *mut u16);
    impl Drop for Arguments {
        fn drop(&mut self) {
            unsafe {
                LocalFree(self.0.cast());
            }
        }
    }
    let _allocation = Arguments(arguments);
    if !(1..=1024).contains(&count) {
        return Err(Error::Safety("invalid command argument count".into()));
    }
    let mut result = Vec::new();
    for index in 0..count as usize {
        let pointer = unsafe { *arguments.add(index) };
        let mut length = 0;
        while length < 32768 && unsafe { *pointer.add(length) } != 0 {
            length += 1;
        }
        if length == 32768 {
            return Err(Error::Safety("command argument exceeds the limit".into()));
        }
        result.push(
            String::from_utf16(unsafe { std::slice::from_raw_parts(pointer, length) })
                .map_err(|_| Error::Safety("invalid UTF-16 command argument".into()))?,
        );
    }
    Ok(result)
}

pub(super) fn process_parents() -> Result<Vec<(u32, u32)>> {
    let snapshot = Handle::new(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) })?;
    let mut entry: PROCESSENTRY32W = unsafe { zeroed() };
    entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
    let mut entries = Vec::new();
    let mut ok = unsafe { Process32FirstW(snapshot.0, &mut entry) };
    while ok != 0 {
        entries.push((entry.th32ProcessID, entry.th32ParentProcessID));
        ok = unsafe { Process32NextW(snapshot.0, &mut entry) };
    }
    if unsafe { GetLastError() } != ERROR_NO_MORE_FILES {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(entries)
}

pub(super) fn process_path(process: &Handle) -> Result<PathBuf> {
    let mut buffer = vec![0u16; 32768];
    let mut size = buffer.len() as u32;
    check(unsafe { QueryFullProcessImageNameW(process.0, 0, buffer.as_mut_ptr(), &mut size) })?;
    Ok(PathBuf::from(String::from_utf16_lossy(
        &buffer[..size as usize],
    )))
}

pub(super) fn process_package(process: &Handle) -> Result<String> {
    let mut size = 0;
    let result = unsafe { GetPackageFullName(process.0, &mut size, null_mut()) };
    if result != ERROR_INSUFFICIENT_BUFFER || size == 0 || size > 32768 {
        return Err(Error::Safety(
            "process has no verifiable package identity".into(),
        ));
    }
    let mut buffer = vec![0u16; size as usize];
    if unsafe { GetPackageFullName(process.0, &mut size, buffer.as_mut_ptr()) } != ERROR_SUCCESS {
        return Err(Error::Safety("process package identity changed".into()));
    }
    Ok(String::from_utf16_lossy(&buffer[..size as usize - 1]))
}

pub(super) fn process_ids() -> Result<Vec<(u32, String)>> {
    let snapshot = Handle::new(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) })?;
    let mut entry: PROCESSENTRY32W = unsafe { zeroed() };
    entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
    let mut entries = Vec::new();
    let mut ok = unsafe { Process32FirstW(snapshot.0, &mut entry) };
    while ok != 0 {
        let len = entry
            .szExeFile
            .iter()
            .position(|c| *c == 0)
            .unwrap_or(entry.szExeFile.len());
        entries.push((
            entry.th32ProcessID,
            String::from_utf16_lossy(&entry.szExeFile[..len]),
        ));
        ok = unsafe { Process32NextW(snapshot.0, &mut entry) };
    }
    let error = unsafe { GetLastError() };
    if error != ERROR_NO_MORE_FILES {
        return Err(std::io::Error::from_raw_os_error(error as i32).into());
    }
    Ok(entries)
}

#[derive(Debug, Clone)]
pub struct Listener {
    pub address: IpAddr,
    pub port: u16,
    pub pid: u32,
}

pub fn listeners() -> Result<Vec<Listener>> {
    let mut rows = Vec::new();
    for family in [AF_INET, AF_INET6] {
        let mut size = 0;
        let result = unsafe {
            GetExtendedTcpTable(
                null_mut(),
                &mut size,
                0,
                family as u32,
                TCP_TABLE_OWNER_PID_LISTENER,
                0,
            )
        };
        if result != ERROR_INSUFFICIENT_BUFFER && result != ERROR_SUCCESS {
            return Err(std::io::Error::from_raw_os_error(result as i32).into());
        }
        let mut success = false;
        for _ in 0..4 {
            if !(4..=16 * 1024 * 1024).contains(&size) {
                return Err(Error::Safety("invalid TCP table size".into()));
            }
            // u32 alignment is sufficient for both OWNER_PID table structures.
            let mut buffer = vec![0u32; (size as usize).div_ceil(4)];
            let result = unsafe {
                GetExtendedTcpTable(
                    buffer.as_mut_ptr().cast(),
                    &mut size,
                    0,
                    family as u32,
                    TCP_TABLE_OWNER_PID_LISTENER,
                    0,
                )
            };
            if result == ERROR_INSUFFICIENT_BUFFER {
                continue;
            }
            if result != ERROR_SUCCESS {
                return Err(std::io::Error::from_raw_os_error(result as i32).into());
            }
            let count = buffer[0] as usize;
            let row_size = if family == AF_INET {
                size_of::<MIB_TCPROW_OWNER_PID>()
            } else {
                size_of::<MIB_TCP6ROW_OWNER_PID>()
            };
            if count > (size as usize - 4) / row_size {
                return Err(Error::Safety("invalid TCP row count".into()));
            }
            for i in 0..count {
                let pointer = unsafe { buffer.as_ptr().cast::<u8>().add(4 + i * row_size) };
                let row = if family == AF_INET {
                    let row = unsafe { pointer.cast::<MIB_TCPROW_OWNER_PID>().read_unaligned() };
                    Listener {
                        address: Ipv4Addr::from(row.dwLocalAddr.to_ne_bytes()).into(),
                        port: u16::from_be(row.dwLocalPort as u16),
                        pid: row.dwOwningPid,
                    }
                } else {
                    let row = unsafe { pointer.cast::<MIB_TCP6ROW_OWNER_PID>().read_unaligned() };
                    Listener {
                        address: Ipv6Addr::from(row.ucLocalAddr).into(),
                        port: u16::from_be(row.dwLocalPort as u16),
                        pid: row.dwOwningPid,
                    }
                };
                rows.push(row);
            }
            success = true;
            break;
        }
        if !success {
            return Err(Error::Safety("TCP table kept changing".into()));
        }
    }
    Ok(rows)
}

pub(super) struct OwnedJob {
    pub job: Handle,
    pub process: Handle,
    pub pid: u32,
}

impl OwnedJob {
    fn new_job() -> Result<Handle> {
        let job = Handle::new(unsafe { CreateJobObjectW(null(), null()) })?;
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        check(unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of_val(&limits) as u32,
            )
        })?;
        Ok(job)
    }

    pub fn spawn(exe: &std::path::Path, arguments: &[String]) -> Result<Self> {
        let job = Self::new_job()?;
        // Use an ordinary DOS path for launching; retain the canonical path for identity checks.
        let canonical = exe.to_string_lossy();
        let launch_path = canonical.strip_prefix("\\\\?\\").unwrap_or(&canonical);
        let app = wide(OsStr::new(launch_path));
        let mut command = vec![quote_argument(launch_path)];
        command.extend(arguments.iter().map(|arg| quote_argument(arg)));
        let mut command = wide(OsStr::new(&command.join(" ")));
        let mut startup: STARTUPINFOW = unsafe { zeroed() };
        startup.cb = size_of_val(&startup) as u32;
        let mut info: PROCESS_INFORMATION = unsafe { zeroed() };
        if unsafe {
            CreateProcessW(
                app.as_ptr(),
                command.as_mut_ptr(),
                null(),
                null(),
                0,
                CREATE_SUSPENDED | CREATE_NO_WINDOW,
                null(),
                null(),
                &startup,
                &mut info,
            )
        } == 0
        {
            return Err(Error::Native {
                operation: "CreateProcessW (official executable, suspended)",
                source: std::io::Error::last_os_error(),
            });
        }
        let process = Handle::new(info.hProcess)?;
        let thread = Handle::new(info.hThread)?;
        // Attach before any application code runs. Children cannot escape this job.
        if let Err(error) = check(unsafe { AssignProcessToJobObject(job.0, process.0) }) {
            unsafe {
                TerminateProcess(process.0, 1);
                WaitForSingleObject(process.0, 5000);
            }
            return Err(Error::Native {
                operation: "AssignProcessToJobObject",
                source: match error {
                    Error::Io(error) => error,
                    _ => std::io::Error::other(error.to_string()),
                },
            });
        }
        if unsafe { ResumeThread(thread.0) } == u32::MAX {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(Self {
            job,
            process,
            pid: info.dwProcessId,
        })
    }

    /// Caller proves package, creation time, activation PID, and unique launch arguments first.
    pub fn adopt(process: Handle, pid: u32, baseline: &HashSet<u32>) -> Result<Self> {
        let job = Self::new_job()?;
        check(unsafe { AssignProcessToJobObject(job.0, process.0) })?;
        let owned = Self { job, process, pid };
        let root_time = creation_time(&owned.process)?;
        let mut known = HashMap::from([(pid, root_time)]);
        let mut held = Vec::new();
        for _ in 0..32 {
            let mut added = false;
            for (child_pid, parent_pid) in process_parents()? {
                if known.contains_key(&child_pid) || baseline.contains(&child_pid) {
                    continue;
                }
                let Some(parent_time) = known.get(&parent_pid).copied() else {
                    continue;
                };
                let child = match open_process(child_pid) {
                    Ok(child) => child,
                    Err(Error::Io(error)) if error.raw_os_error() == Some(87) => continue,
                    Err(error) => return Err(error),
                };
                let child_time = creation_time(&child)?;
                if child_time < parent_time || child_time < root_time {
                    continue;
                }
                if !owned.contains(&child)? {
                    let managed = open_managed_process(child_pid)?;
                    if creation_time(&managed)? != child_time {
                        return Err(Error::Safety("bootstrap process identity changed".into()));
                    }
                    check(unsafe { AssignProcessToJobObject(owned.job.0, managed.0) })?;
                }
                known.insert(child_pid, child_time);
                held.push(child);
                added = true;
            }
            // Once every known parent is owned, subsequently created children inherit the job.
            if !added {
                return Ok(owned);
            }
        }
        Err(Error::Safety(
            "package bootstrap tree did not stabilize".into(),
        ))
    }

    pub fn contains(&self, process: &Handle) -> Result<bool> {
        let mut inside = 0;
        check(unsafe { IsProcessInJob(process.0, self.job.0, &mut inside) })?;
        Ok(inside != 0)
    }

    pub fn active_count(&self) -> Result<u32> {
        let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { zeroed() };
        check(unsafe {
            QueryInformationJobObject(
                self.job.0,
                JobObjectBasicAccountingInformation,
                (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                size_of_val(&accounting) as u32,
                null_mut(),
            )
        })?;
        Ok(accounting.ActiveProcesses)
    }

    pub fn terminate(&self) -> Result<()> {
        check(unsafe { TerminateJobObject(self.job.0, 0) })?;
        let deadline = Instant::now() + Duration::from_secs(10);
        while self.active_count()? != 0 {
            if Instant::now() >= deadline {
                return Err(Error::Timeout("owned process cleanup"));
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        Ok(())
    }
}

pub fn quote_argument(value: &str) -> String {
    let mut output = String::from("\"");
    let mut slashes = 0;
    for ch in value.chars() {
        if ch == '\\' {
            slashes += 1;
            continue;
        }
        output.extend(std::iter::repeat_n(
            '\\',
            if ch == '"' { slashes * 2 + 1 } else { slashes },
        ));
        output.push(ch);
        slashes = 0;
    }
    output.extend(std::iter::repeat_n('\\', slashes * 2));
    output.push('"');
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quote_windows_paths_and_quotes() {
        assert_eq!(quote_argument(""), "\"\"");
        assert_eq!(quote_argument("C:\\two words\\"), "\"C:\\two words\\\\\"");
        assert_eq!(quote_argument("a\"b"), "\"a\\\"b\"");
    }
    #[test]
    fn native_listener_table_finds_loopback_owner() {
        let socket = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = socket.local_addr().unwrap().port();
        assert!(listeners().unwrap().iter().any(|row| row.port == port
            && row.pid == std::process::id()
            && row.address == IpAddr::V4(Ipv4Addr::LOCALHOST)));
    }

    #[test]
    fn owned_job_termination_does_not_include_the_test_runner() {
        let system = std::env::var_os("SystemRoot").unwrap();
        let ping = PathBuf::from(system).join("System32").join("ping.exe");
        let job = OwnedJob::spawn(&ping, &["-t".into(), "127.0.0.1".into()]).unwrap();
        assert!(job.contains(&job.process).unwrap());
        let runner = open_process(std::process::id()).unwrap();
        assert!(!job.contains(&runner).unwrap());
        job.terminate().unwrap();
        assert_eq!(job.active_count().unwrap(), 0);
        assert_eq!(
            unsafe { WaitForSingleObject(job.process.0, 1000) },
            WAIT_OBJECT_0
        );
    }
}
