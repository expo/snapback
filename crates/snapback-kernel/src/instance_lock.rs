//! Local app-instance ownership locks.
//!
//! A file-backed local server owns both the SQLite database and process-local
//! runtime state. The sidecar lock prevents two server processes from appearing
//! as separate instances while mutating the same database.

use anyhow::{Context, anyhow};
use serde::{Deserialize, Serialize};
use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug)]
pub struct DatabaseInstanceLock {
    file: File,
    db_path: PathBuf,
    lock_path: PathBuf,
    started_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DatabaseInstanceMetadata {
    pub pid: u32,
    pub db_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub started_at_ms: u64,
}

impl DatabaseInstanceLock {
    pub fn acquire(db_path: impl AsRef<Path>) -> anyhow::Result<Self> {
        let db_path = db_path.as_ref().to_path_buf();
        let lock_path = lock_path_for_database(&db_path)?;
        if let Some(parent) = lock_path.parent() {
            std::fs::create_dir_all(parent).with_context(|| {
                format!(
                    "failed to create Snapback database lock directory {}",
                    parent.display()
                )
            })?;
        }

        let mut file = platform::open_lock_file(&lock_path).with_context(|| {
            format!(
                "failed to open a safe Snapback database lock {}",
                lock_path.display()
            )
        })?;

        if let Err(error) = platform::try_lock_exclusive(&file) {
            if error.kind() == io::ErrorKind::WouldBlock {
                let owner = read_metadata(&mut file).ok().flatten();
                return Err(anyhow!(lock_held_message(&db_path, &lock_path, owner)));
            }
            return Err(error).with_context(|| {
                format!(
                    "failed to lock Snapback database lock {}",
                    lock_path.display()
                )
            });
        }

        let mut lock = Self {
            file,
            db_path,
            lock_path,
            started_at_ms: now_millis(),
        };
        lock.write_metadata(None, None)?;
        Ok(lock)
    }

    pub fn record_server(&mut self, host: &str, port: u16) -> anyhow::Result<()> {
        self.write_metadata(Some(host), Some(port))
    }

    #[cfg(any(test, feature = "test-support"))]
    fn lock_path(&self) -> &Path {
        &self.lock_path
    }

    fn write_metadata(&mut self, host: Option<&str>, port: Option<u16>) -> anyhow::Result<()> {
        let url = host
            .zip(port)
            .map(|(host, port)| format!("http://{}:{port}", url_host(host)));
        let metadata = DatabaseInstanceMetadata {
            pid: std::process::id(),
            db_path: self.db_path.display().to_string(),
            host: host.map(ToOwned::to_owned),
            port,
            url,
            started_at_ms: self.started_at_ms,
        };

        self.file.set_len(0).with_context(|| {
            format!(
                "failed to truncate Snapback database lock {}",
                self.lock_path.display()
            )
        })?;
        self.file.seek(SeekFrom::Start(0))?;
        serde_json::to_writer_pretty(&mut self.file, &metadata)
            .context("failed to serialize Snapback database lock metadata")?;
        self.file.write_all(b"\n")?;
        self.file.sync_data().with_context(|| {
            format!(
                "failed to flush Snapback database lock {}",
                self.lock_path.display()
            )
        })?;
        Ok(())
    }
}

impl Drop for DatabaseInstanceLock {
    fn drop(&mut self) {
        let _ = platform::unlock(&self.file);
    }
}

pub fn lock_path_for_database(db_path: &Path) -> anyhow::Result<PathBuf> {
    let file_name = db_path.file_name().ok_or_else(|| {
        anyhow!(
            "Snapback database path has no file name: {}",
            db_path.display()
        )
    })?;
    let mut lock_name: OsString = file_name.to_os_string();
    lock_name.push(".snapback.lock");
    Ok(db_path
        .parent()
        .map(|parent| parent.join(&lock_name))
        .unwrap_or_else(|| PathBuf::from(lock_name)))
}

pub fn target_reservation_path_for_database(db_path: &Path) -> anyhow::Result<PathBuf> {
    let instance = db_path.parent().ok_or_else(|| {
        anyhow!(
            "restore database path has no instance directory: {}",
            db_path.display()
        )
    })?;
    let instance_name = instance.file_name().ok_or_else(|| {
        anyhow!(
            "restore instance path has no directory name: {}",
            instance.display()
        )
    })?;
    let mut lock_name = instance_name.to_os_string();
    lock_name.push(".snapback.restore.lock");
    Ok(instance
        .parent()
        .map(|parent| parent.join(&lock_name))
        .unwrap_or_else(|| PathBuf::from(lock_name)))
}

const TARGET_RESERVATION_KIND: &str = "snapback.target-instance-reservation.v1";
const TARGET_RESERVATION_FORMAT_VERSION: u32 = 1;
const TARGET_RESERVATION_RECORD_MAX_BYTES: u64 = 4096;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TargetReservationRecord {
    kind: String,
    format_version: u32,
    target_instance_hex: String,
    pid: u32,
    started_at_ms: u64,
}

/// An outer, instance-name reservation used while the instance directory does
/// not yet exist. Unlike [`DatabaseInstanceLock`], this guard pins the existing
/// parent directory and keeps the persistent sibling lock entry tied to that
/// exact directory capability.
// @ref LLP 0057#restore — restore is offline under the target-instance lock and publishes one complete required-absent directory.
pub struct TargetInstanceReservation {
    parent: File,
    parent_path: PathBuf,
    parent_identity: (u64, u64),
    target_instance: PathBuf,
    target_name: OsString,
    lock_file: File,
    lock_name: OsString,
    lock_identity: (u64, u64),
}

/// Normalize the platform-specific `dev_t` representation used by `libc::stat`.
///
/// Linux already exposes `st_dev` as `u64`, while the other supported Unix
/// targets require an explicit normalization.
#[cfg(target_os = "linux")]
pub fn stat_device_id(stat: &libc::stat) -> u64 {
    stat.st_dev
}

#[cfg(all(unix, not(target_os = "linux")))]
pub fn stat_device_id(stat: &libc::stat) -> u64 {
    stat.st_dev as u64
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FileIdentity {
    device: u64,
    inode: u64,
}

impl FileIdentity {
    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    pub fn from_file(file: &File) -> io::Result<Self> {
        use std::os::unix::fs::MetadataExt as _;

        let metadata = file.metadata()?;
        Ok(Self {
            device: metadata.dev(),
            inode: metadata.ino(),
        })
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    pub fn from_stat(stat: &libc::stat) -> Self {
        Self {
            device: stat_device_id(stat),
            inode: stat.st_ino,
        }
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    pub fn matches_stat(self, stat: &libc::stat) -> bool {
        self == Self::from_stat(stat)
    }
}

/// Holds the outer restore/start reservation and the exact instance directory
/// inode from path preparation until the inside-instance lock and database are
/// opened. Keeping the descriptor live prevents an inode-number reuse from
/// making a removed-and-recreated target look like the prepared directory.
pub struct StartupTargetReservation {
    reservation: TargetInstanceReservation,
    target_directory: File,
    target_identity: FileIdentity,
}

impl std::fmt::Debug for StartupTargetReservation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("StartupTargetReservation")
            .field("reservation", &self.reservation)
            .field("target_identity", &self.target_identity)
            .finish_non_exhaustive()
    }
}

impl StartupTargetReservation {
    pub fn acquire(db_path: impl AsRef<Path>) -> anyhow::Result<Self> {
        #[cfg(any(target_vendor = "apple", target_os = "linux"))]
        {
            let reservation = TargetInstanceReservation::acquire(db_path)?;
            let (target_directory, target_identity) =
                reservation.open_or_create_instance_directory_for_startup()?;
            let target = Self {
                reservation,
                target_directory,
                target_identity,
            };
            target.ensure_valid()?;
            Ok(target)
        }
        #[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
        {
            let _ = db_path;
            Err(anyhow!(
                "descriptor-pinned startup target reservations are unsupported on this host"
            ))
        }
    }

    pub fn ensure_valid(&self) -> anyhow::Result<()> {
        #[cfg(any(target_vendor = "apple", target_os = "linux"))]
        {
            let descriptor_identity = FileIdentity::from_file(&self.target_directory)?;
            anyhow::ensure!(
                descriptor_identity == self.target_identity,
                "prepared target-instance descriptor identity changed"
            );
            self.reservation
                .ensure_target_identity(self.target_identity)
        }
        #[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
        {
            Err(anyhow!(
                "descriptor-pinned startup target reservations are unsupported on this host"
            ))
        }
    }
}

#[cfg(any(target_vendor = "apple", target_os = "linux"))]
struct CreatedReservationCleanup<'a> {
    parent: &'a File,
    name: std::ffi::CString,
    identity: (u64, u64),
    armed: bool,
}

#[cfg(any(target_vendor = "apple", target_os = "linux"))]
impl CreatedReservationCleanup<'_> {
    fn disarm(&mut self) {
        self.armed = false;
    }
}

#[cfg(any(target_vendor = "apple", target_os = "linux"))]
impl Drop for CreatedReservationCleanup<'_> {
    fn drop(&mut self) {
        use std::mem::MaybeUninit;
        use std::os::fd::AsRawFd as _;

        if !self.armed {
            return;
        }
        let mut stat = MaybeUninit::<libc::stat>::uninit();
        let found = unsafe {
            libc::fstatat(
                self.parent.as_raw_fd(),
                self.name.as_ptr(),
                stat.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } == 0;
        if found {
            let stat = unsafe { stat.assume_init() };
            if (stat_device_id(&stat), stat.st_ino) == self.identity {
                unsafe {
                    libc::unlinkat(self.parent.as_raw_fd(), self.name.as_ptr(), 0);
                }
                let _ = self.parent.sync_all();
            }
        }
    }
}

impl std::fmt::Debug for TargetInstanceReservation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TargetInstanceReservation")
            .field("target_instance", &self.target_instance)
            .field("parent_identity", &self.parent_identity)
            .field("lock_identity", &self.lock_identity)
            .finish_non_exhaustive()
    }
}

impl Drop for TargetInstanceReservation {
    fn drop(&mut self) {
        // `flock` survives duplicated descriptors, including the interval
        // between fork and exec. Release the reservation deliberately instead
        // of relying on this guard's descriptor being the final open copy.
        let _ = platform::unlock(&self.lock_file);
    }
}

impl TargetInstanceReservation {
    /// Reserve the instance containing `db_path` without creating that
    /// instance. Unsupported hosts fail before creating a lock or target.
    pub fn acquire(db_path: impl AsRef<Path>) -> anyhow::Result<Self> {
        #[cfg(any(target_vendor = "apple", target_os = "linux"))]
        {
            Self::acquire_supported(db_path.as_ref())
        }
        #[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
        {
            let _ = db_path;
            Err(anyhow!(
                "descriptor-pinned target-instance reservations are unsupported on this host"
            ))
        }
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    fn acquire_supported(db_path: &Path) -> anyhow::Result<Self> {
        use std::os::fd::{AsRawFd as _, FromRawFd as _};
        use std::os::unix::ffi::OsStrExt as _;
        use std::os::unix::fs::{MetadataExt as _, OpenOptionsExt as _, PermissionsExt as _};

        let database_name = db_path
            .file_name()
            .filter(|name| *name != OsStr::new(".") && *name != OsStr::new(".."))
            .ok_or_else(|| anyhow!("target database path has no file name"))?;
        let requested_instance = db_path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .ok_or_else(|| anyhow!("target database has no instance directory"))?;
        let target_name = requested_instance
            .file_name()
            .filter(|name| *name != OsStr::new(".") && *name != OsStr::new(".."))
            .ok_or_else(|| anyhow!("target instance path has no directory name"))?
            .to_os_string();
        let requested_parent = requested_instance
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let parent_path = std::fs::canonicalize(requested_parent).with_context(|| {
            format!(
                "failed to resolve target-instance parent {}",
                requested_parent.display()
            )
        })?;
        let target_instance = parent_path.join(&target_name);
        let canonical_database = target_instance.join(database_name);
        let lock_path = target_reservation_path_for_database(&canonical_database)?;
        let lock_name = lock_path
            .file_name()
            .expect("a target reservation lock always has a basename")
            .to_os_string();

        let parent = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(&parent_path)
            .with_context(|| {
                format!(
                    "failed to pin target-instance parent {}",
                    parent_path.display()
                )
            })?;
        let parent_metadata = parent.metadata()?;
        anyhow::ensure!(
            parent_metadata.file_type().is_dir(),
            "target-instance parent is not a directory"
        );
        let parent_identity = (parent_metadata.dev(), parent_metadata.ino());

        let lock_name_c = std::ffi::CString::new(lock_name.as_bytes())
            .map_err(|_| anyhow!("target-instance reservation name contains NUL"))?;
        // First creation is exclusive. Existing entries are opened without
        // mutation and must prove they are our exact closed stale record after
        // the OS lock is acquired.
        let mut created = false;
        let mut fd = unsafe {
            libc::openat(
                parent.as_raw_fd(),
                lock_name_c.as_ptr(),
                libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        };
        if fd >= 0 {
            created = true;
        } else if io::Error::last_os_error().kind() == io::ErrorKind::AlreadyExists {
            fd = unsafe {
                libc::openat(
                    parent.as_raw_fd(),
                    lock_name_c.as_ptr(),
                    libc::O_RDWR | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                    0,
                )
            };
        }
        if fd < 0 {
            return Err(io::Error::last_os_error()).with_context(|| {
                format!(
                    "failed to open target-instance reservation {}",
                    lock_path.display()
                )
            });
        }
        let mut lock_file = unsafe { File::from_raw_fd(fd) };
        if created {
            lock_file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        }
        validate_target_reservation_file(&lock_file)?;
        let lock_metadata = lock_file.metadata()?;
        let lock_identity = (lock_metadata.dev(), lock_metadata.ino());
        let mut created_cleanup = created.then(|| CreatedReservationCleanup {
            parent: &parent,
            name: lock_name_c.clone(),
            identity: lock_identity,
            armed: true,
        });
        let strict_path_file = crate::secure_file::open_strict_owner_only(&lock_path)
            .context("target-instance reservation is not strictly owner-only")?;
        let strict_path_metadata = strict_path_file.metadata()?;
        anyhow::ensure!(
            (strict_path_metadata.dev(), strict_path_metadata.ino()) == lock_identity,
            "target-instance reservation path does not name the opened inode"
        );

        if let Err(error) = platform::try_lock_exclusive(&lock_file) {
            if error.kind() == io::ErrorKind::WouldBlock {
                return Err(anyhow!(
                    "Snapback target instance is already reserved by another process:\n  target: {}\n  lock: {}",
                    target_instance.display(),
                    lock_path.display()
                ));
            }
            return Err(error).context("failed to lock target-instance reservation");
        }

        let expected_target_hex = os_path_hex(&target_instance);
        if created {
            let record = TargetReservationRecord {
                kind: TARGET_RESERVATION_KIND.to_owned(),
                format_version: TARGET_RESERVATION_FORMAT_VERSION,
                target_instance_hex: expected_target_hex,
                pid: std::process::id(),
                started_at_ms: now_millis(),
            };
            write_target_reservation_record(&mut lock_file, &record)?;
            parent.sync_all()?;
        } else {
            let record = read_target_reservation_record(&mut lock_file)?;
            anyhow::ensure!(
                record.kind == TARGET_RESERVATION_KIND
                    && record.format_version == TARGET_RESERVATION_FORMAT_VERSION
                    && record.target_instance_hex == expected_target_hex,
                "existing target-instance reservation is not the exact closed record for this target"
            );
        }

        if let Some(cleanup) = &mut created_cleanup {
            cleanup.disarm();
        }
        drop(created_cleanup);

        let reservation = Self {
            parent,
            parent_path,
            parent_identity,
            target_instance,
            target_name,
            lock_file,
            lock_name,
            lock_identity,
        };
        reservation.ensure_valid()?;
        Ok(reservation)
    }

    pub fn ensure_target_absent(&self) -> anyhow::Result<()> {
        self.ensure_valid()?;
        anyhow::ensure!(
            self.stat_at(&self.target_name)?.is_none(),
            "target instance directory already exists"
        );
        Ok(())
    }

    /// Pin an existing instance or create and pin an absent instance for
    /// ordinary startup while holding the same reservation a restore needs.
    /// The returned descriptor and identity remain live through the inner
    /// database-lock handoff.
    fn open_or_create_instance_directory_for_startup(
        &self,
    ) -> anyhow::Result<(File, FileIdentity)> {
        #[cfg(any(target_vendor = "apple", target_os = "linux"))]
        {
            use std::os::fd::{AsRawFd as _, FromRawFd as _};
            use std::os::unix::ffi::OsStrExt as _;
            use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

            self.ensure_valid()?;
            let name = std::ffi::CString::new(self.target_name.as_bytes())
                .map_err(|_| anyhow!("target instance name contains NUL"))?;
            let open = || unsafe {
                libc::openat(
                    self.parent.as_raw_fd(),
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                    0,
                )
            };
            let mut created = false;
            let mut fd = open();
            if fd < 0 && io::Error::last_os_error().kind() == io::ErrorKind::NotFound {
                if unsafe { libc::mkdirat(self.parent.as_raw_fd(), name.as_ptr(), 0o700) } != 0 {
                    return Err(io::Error::last_os_error())
                        .context("failed to create reserved target instance directory");
                }
                created = true;
                fd = open();
            }
            if fd < 0 {
                return Err(io::Error::last_os_error())
                    .context("failed to pin reserved target instance directory");
            }
            let directory = unsafe { File::from_raw_fd(fd) };
            let identity = FileIdentity::from_file(&directory)?;
            let result = (|| -> anyhow::Result<(File, FileIdentity)> {
                if created {
                    directory.set_permissions(std::fs::Permissions::from_mode(0o700))?;
                    let metadata = directory.metadata()?;
                    anyhow::ensure!(
                        metadata.file_type().is_dir()
                            && metadata.uid() == unsafe { libc::geteuid() }
                            && metadata.permissions().mode() & 0o777 == 0o700,
                        "reserved target instance directory is not strictly owner-only"
                    );
                    self.parent.sync_all()?;
                }
                self.ensure_valid()?;
                self.ensure_target_identity(identity)?;
                Ok((directory, identity))
            })();
            if result.is_err()
                && created
                && self
                    .stat_at(&self.target_name)
                    .ok()
                    .flatten()
                    .is_some_and(|stat| identity.matches_stat(&stat))
            {
                unsafe {
                    libc::unlinkat(self.parent.as_raw_fd(), name.as_ptr(), libc::AT_REMOVEDIR);
                }
                let _ = self.parent.sync_all();
            }
            result
        }
        #[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
        {
            Err(anyhow!(
                "descriptor-relative target creation is unsupported on this host"
            ))
        }
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    fn ensure_target_identity(&self, expected: FileIdentity) -> anyhow::Result<()> {
        self.ensure_valid()?;
        let stat = self
            .stat_at(&self.target_name)?
            .ok_or_else(|| anyhow!("prepared target instance disappeared"))?;
        anyhow::ensure!(
            stat.st_mode & libc::S_IFMT == libc::S_IFDIR && expected.matches_stat(&stat),
            "prepared target instance identity changed"
        );
        Ok(())
    }

    #[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
    fn ensure_target_identity(&self, _expected: FileIdentity) -> anyhow::Result<()> {
        Err(anyhow!(
            "descriptor-relative target validation is unsupported on this host"
        ))
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    pub fn create_staging_directory(
        &self,
        name: &OsStr,
    ) -> io::Result<(File, PathBuf, FileIdentity)> {
        use std::os::fd::{AsRawFd as _, FromRawFd as _};
        use std::os::unix::ffi::OsStrExt as _;
        use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

        self.ensure_valid().map_err(io::Error::other)?;
        let name_c = std::ffi::CString::new(name.as_bytes()).map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidInput, "staging name contains NUL")
        })?;
        if unsafe { libc::mkdirat(self.parent.as_raw_fd(), name_c.as_ptr(), 0o700) } != 0 {
            return Err(io::Error::last_os_error());
        }
        let fd = unsafe {
            libc::openat(
                self.parent.as_raw_fd(),
                name_c.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0,
            )
        };
        if fd < 0 {
            let error = io::Error::last_os_error();
            unsafe {
                libc::unlinkat(self.parent.as_raw_fd(), name_c.as_ptr(), libc::AT_REMOVEDIR);
            }
            return Err(error);
        }
        let directory = unsafe { File::from_raw_fd(fd) };
        let identity = FileIdentity::from_file(&directory)?;
        let result = (|| -> io::Result<()> {
            directory.set_permissions(std::fs::Permissions::from_mode(0o700))?;
            let metadata = directory.metadata()?;
            if !metadata.file_type().is_dir()
                || metadata.uid() != unsafe { libc::geteuid() }
                || metadata.permissions().mode() & 0o777 != 0o700
            {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "staging directory is not strictly owner-only",
                ));
            }
            self.ensure_valid().map_err(io::Error::other)
        })();
        if let Err(error) = result {
            if self
                .stat_at(name)
                .ok()
                .flatten()
                .is_some_and(|stat| identity.matches_stat(&stat))
            {
                unsafe {
                    libc::unlinkat(self.parent.as_raw_fd(), name_c.as_ptr(), libc::AT_REMOVEDIR);
                }
                let _ = self.parent.sync_all();
            }
            return Err(error);
        }
        Ok((directory, self.parent_path.join(name), identity))
    }

    #[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
    pub fn create_staging_directory(
        &self,
        _name: &OsStr,
    ) -> io::Result<(File, PathBuf, FileIdentity)> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "descriptor-relative restore staging is unsupported on this host",
        ))
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    pub fn ensure_staging_directory_identity(
        &self,
        name: &OsStr,
        expected: FileIdentity,
    ) -> io::Result<()> {
        self.ensure_valid().map_err(io::Error::other)?;
        self.ensure_entry_identity(name, expected, libc::S_IFDIR)
    }

    #[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
    pub fn ensure_staging_directory_identity(
        &self,
        _name: &OsStr,
        _expected: FileIdentity,
    ) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "descriptor-relative restore staging is unsupported on this host",
        ))
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    pub fn rename_staging_directory(
        &self,
        name: &OsStr,
        expected: FileIdentity,
    ) -> io::Result<()> {
        self.ensure_valid().map_err(io::Error::other)?;
        self.ensure_entry_identity(name, expected, libc::S_IFDIR)?;
        crate::secure_file::rename_no_replace_in_directory(&self.parent, name, &self.target_name)
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    pub fn ensure_published_directory_identity(
        &self,
        expected: FileIdentity,
    ) -> io::Result<()> {
        self.ensure_valid().map_err(io::Error::other)?;
        self.ensure_entry_identity(&self.target_name, expected, libc::S_IFDIR)
    }

    #[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
    pub fn rename_staging_directory(
        &self,
        _name: &OsStr,
        _expected: FileIdentity,
    ) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "descriptor-relative restore publication is unsupported on this host",
        ))
    }

    #[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
    pub fn ensure_published_directory_identity(
        &self,
        _expected: FileIdentity,
    ) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "descriptor-relative restore publication is unsupported on this host",
        ))
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    pub fn sync_parent(&self) -> io::Result<()> {
        self.parent.sync_all()
    }

    #[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
    pub fn sync_parent(&self) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "descriptor-relative restore publication is unsupported on this host",
        ))
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    pub fn remove_staging_directory(
        &self,
        name: &OsStr,
        expected: FileIdentity,
    ) -> io::Result<()> {
        use std::os::fd::AsRawFd as _;
        use std::os::unix::ffi::OsStrExt as _;

        let name_c = std::ffi::CString::new(name.as_bytes()).map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidInput, "staging name contains NUL")
        })?;
        match self.stat_at(name)? {
            None => return Ok(()),
            Some(stat)
                if stat.st_mode & libc::S_IFMT == libc::S_IFDIR && expected.matches_stat(&stat) => {
            }
            Some(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "staging directory entry identity changed; refusing cleanup",
                ));
            }
        }
        let result =
            unsafe { libc::unlinkat(self.parent.as_raw_fd(), name_c.as_ptr(), libc::AT_REMOVEDIR) };
        if result == 0 {
            let _ = self.parent.sync_all();
            Ok(())
        } else {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::NotFound {
                Ok(())
            } else {
                Err(error)
            }
        }
    }

    #[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
    pub fn remove_staging_directory(
        &self,
        _name: &OsStr,
        _expected: FileIdentity,
    ) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "descriptor-relative restore cleanup is unsupported on this host",
        ))
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    pub fn ensure_valid(&self) -> anyhow::Result<()> {
        use std::os::unix::fs::MetadataExt as _;

        let parent = std::fs::symlink_metadata(&self.parent_path)?;
        anyhow::ensure!(
            parent.file_type().is_dir() && (parent.dev(), parent.ino()) == self.parent_identity,
            "target-instance parent identity changed while reserved"
        );
        validate_target_reservation_file(&self.lock_file)?;
        let lock = self
            .stat_at(&self.lock_name)?
            .ok_or_else(|| anyhow!("target-instance reservation entry disappeared"))?;
        anyhow::ensure!(
            (stat_device_id(&lock), lock.st_ino) == self.lock_identity,
            "target-instance reservation entry changed while locked"
        );
        let strict =
            crate::secure_file::open_strict_owner_only(&self.parent_path.join(&self.lock_name))?;
        let strict_metadata = strict.metadata()?;
        anyhow::ensure!(
            (strict_metadata.dev(), strict_metadata.ino()) == self.lock_identity,
            "target-instance reservation path changed while locked"
        );
        Ok(())
    }

    #[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
    pub fn ensure_valid(&self) -> anyhow::Result<()> {
        Err(anyhow!(
            "descriptor-pinned target-instance reservations are unsupported on this host"
        ))
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    fn stat_at(&self, name: &OsStr) -> io::Result<Option<libc::stat>> {
        use std::mem::MaybeUninit;
        use std::os::fd::AsRawFd as _;
        use std::os::unix::ffi::OsStrExt as _;

        let name = std::ffi::CString::new(name.as_bytes())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path name contains NUL"))?;
        let mut stat = MaybeUninit::<libc::stat>::uninit();
        let result = unsafe {
            libc::fstatat(
                self.parent.as_raw_fd(),
                name.as_ptr(),
                stat.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        };
        if result == 0 {
            return Ok(Some(unsafe { stat.assume_init() }));
        }
        let error = io::Error::last_os_error();
        if error.kind() == io::ErrorKind::NotFound {
            Ok(None)
        } else {
            Err(error)
        }
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    fn ensure_entry_identity(
        &self,
        name: &OsStr,
        expected: FileIdentity,
        expected_kind: libc::mode_t,
    ) -> io::Result<()> {
        let stat = self.stat_at(name)?.ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "reserved directory entry disappeared",
            )
        })?;
        if stat.st_mode & libc::S_IFMT != expected_kind || !expected.matches_stat(&stat) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "reserved directory entry identity changed",
            ));
        }
        Ok(())
    }
}

#[cfg(any(target_vendor = "apple", target_os = "linux"))]
fn validate_target_reservation_file(file: &File) -> anyhow::Result<()> {
    use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

    let metadata = file.metadata()?;
    anyhow::ensure!(
        metadata.file_type().is_file()
            && metadata.uid() == unsafe { libc::geteuid() }
            && metadata.permissions().mode() & 0o777 == 0o600
            && metadata.nlink() == 1,
        "target-instance reservation must be one owner-only regular-file link"
    );
    Ok(())
}

fn read_target_reservation_record(file: &mut File) -> anyhow::Result<TargetReservationRecord> {
    file.seek(SeekFrom::Start(0))?;
    let mut bytes = Vec::new();
    file.take(TARGET_RESERVATION_RECORD_MAX_BYTES + 1)
        .read_to_end(&mut bytes)?;
    anyhow::ensure!(
        bytes.len() as u64 <= TARGET_RESERVATION_RECORD_MAX_BYTES,
        "target-instance reservation record is too large"
    );
    let record = serde_json::from_slice(&bytes)
        .context("target-instance reservation is not a closed record")?;
    Ok(record)
}

fn write_target_reservation_record(
    file: &mut File,
    record: &TargetReservationRecord,
) -> anyhow::Result<()> {
    let bytes = serde_json::to_vec(record)?;
    anyhow::ensure!(
        bytes.len() as u64 <= TARGET_RESERVATION_RECORD_MAX_BYTES,
        "target-instance reservation record is too large"
    );
    file.set_len(0)?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(&bytes)?;
    file.write_all(b"\n")?;
    file.sync_data()?;
    Ok(())
}

#[cfg(any(target_vendor = "apple", target_os = "linux"))]
fn os_path_hex(path: &Path) -> String {
    use std::os::unix::ffi::OsStrExt as _;

    const HEX: &[u8; 16] = b"0123456789abcdef";
    let bytes = path.as_os_str().as_bytes();
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

fn read_metadata(file: &mut File) -> anyhow::Result<Option<DatabaseInstanceMetadata>> {
    file.seek(SeekFrom::Start(0))?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)?;
    let contents = contents.trim();
    if contents.is_empty() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_str(contents)?))
}

fn lock_held_message(
    db_path: &Path,
    lock_path: &Path,
    owner: Option<DatabaseInstanceMetadata>,
) -> String {
    let mut message = format!(
        "Snapback database is already owned by another local server:\n  db: {}",
        db_path.display()
    );
    if let Some(owner) = owner {
        if let Some(url) = owner.url {
            message.push_str(&format!("\n  server: {url}"));
        } else {
            message.push_str("\n  server: starting (port not bound yet)");
        }
        message.push_str(&format!("\n  pid: {}", owner.pid));
    } else {
        message.push_str(&format!(
            "\n  lock: {}\n  owner metadata: unavailable",
            lock_path.display()
        ));
    }
    message.push_str("\n\nUse that server, stop it, pass --memory, or choose a different --db.");
    message
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn url_host(host: &str) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_owned()
    }
}

#[cfg(unix)]
mod platform {
    use std::fs::{File, OpenOptions};
    use std::io;
    use std::os::fd::AsRawFd;
    use std::os::raw::c_int;
    use std::os::unix::fs::{MetadataExt as _, OpenOptionsExt as _, PermissionsExt as _};
    use std::path::Path;

    const LOCK_EX: c_int = 2;
    const LOCK_NB: c_int = 4;
    const LOCK_UN: c_int = 8;

    unsafe extern "C" {
        fn flock(fd: c_int, operation: c_int) -> c_int;
    }

    pub fn open_lock_file(path: &Path) -> io::Result<File> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(path)?;
        validate_lock_file(&file, effective_uid())?;
        let metadata = file.metadata()?;
        if metadata.mode() & 0o777 != 0o600 {
            file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(file)
    }

    fn effective_uid() -> u32 {
        // SAFETY: geteuid has no preconditions and only reads process identity.
        unsafe { libc::geteuid() }
    }

    fn validate_lock_file(file: &File, expected_uid: u32) -> io::Result<()> {
        let metadata = file.metadata()?;
        if !metadata.file_type().is_file() {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "database lock path is not a regular file",
            ));
        }
        if metadata.uid() != expected_uid {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "database lock file is not owned by the effective user",
            ));
        }
        Ok(())
    }

    #[cfg(any(test, feature = "test-support"))]
    pub(super) fn validate_for_effective_uid(file: &File, expected_uid: u32) -> io::Result<()> {
        validate_lock_file(file, expected_uid)
    }

    pub fn try_lock_exclusive(file: &File) -> io::Result<()> {
        let result = unsafe { flock(file.as_raw_fd(), LOCK_EX | LOCK_NB) };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    pub fn unlock(file: &File) -> io::Result<()> {
        let result = unsafe { flock(file.as_raw_fd(), LOCK_UN) };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::fs::{File, OpenOptions};
    use std::io;
    use std::mem::{size_of, zeroed};
    use std::os::windows::fs::OpenOptionsExt as _;
    use std::os::windows::io::AsRawHandle;
    use std::path::Path;
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::{
        CloseHandle, ERROR_SUCCESS, GENERIC_READ, GENERIC_WRITE, HANDLE, LocalFree,
    };
    use windows_sys::Win32::Security::Authorization::{
        GetSecurityInfo, SE_FILE_OBJECT, SetSecurityInfo,
    };
    use windows_sys::Win32::Security::{
        ACCESS_ALLOWED_ACE, ACL, ACL_REVISION, AddAccessAllowedAceEx, DACL_SECURITY_INFORMATION,
        EqualSid, GetLengthSid, GetTokenInformation, InitializeAcl, OWNER_SECURITY_INFORMATION,
        PROTECTED_DACL_SECURITY_INFORMATION, PSID, TOKEN_QUERY, TOKEN_USER, TokenUser,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ALL_ACCESS, FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_TAG_INFO,
        FILE_FLAG_OPEN_REPARSE_POINT, FileAttributeTagInfo, GetFileInformationByHandleEx,
        READ_CONTROL, WRITE_DAC,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    type Bool = i32;
    type Dword = u32;
    type Handle = *mut c_void;

    const LOCKFILE_EXCLUSIVE_LOCK: Dword = 0x00000002;
    const LOCKFILE_FAIL_IMMEDIATELY: Dword = 0x00000001;
    const ERROR_LOCK_VIOLATION: i32 = 33;
    // Keep the byte-range lock away from the metadata JSON at the start of the
    // sidecar file. Windows enforces byte-range locks against normal reads, so
    // locking byte 0 made contenders unable to read the owner diagnostic.
    const LOCK_BYTE_OFFSET_LOW: Dword = 0xFFFF_FFFF;
    const LOCK_BYTE_OFFSET_HIGH: Dword = 0xFFFF_FFFF;

    #[repr(C)]
    struct Overlapped {
        internal: usize,
        internal_high: usize,
        offset: Dword,
        offset_high: Dword,
        h_event: Handle,
    }

    impl Overlapped {
        fn lock_byte() -> Self {
            Self {
                internal: 0,
                internal_high: 0,
                offset: LOCK_BYTE_OFFSET_LOW,
                offset_high: LOCK_BYTE_OFFSET_HIGH,
                h_event: null_mut(),
            }
        }
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn LockFileEx(
            hFile: Handle,
            dwFlags: Dword,
            dwReserved: Dword,
            nNumberOfBytesToLockLow: Dword,
            nNumberOfBytesToLockHigh: Dword,
            lpOverlapped: *mut Overlapped,
        ) -> Bool;
        fn UnlockFileEx(
            hFile: Handle,
            dwReserved: Dword,
            nNumberOfBytesToUnlockLow: Dword,
            nNumberOfBytesToUnlockHigh: Dword,
            lpOverlapped: *mut Overlapped,
        ) -> Bool;
    }

    struct OwnedHandle(HANDLE);

    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: the handle was returned by OpenProcessToken and is
                // owned by this guard.
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
    }

    pub fn open_lock_file(path: &Path) -> io::Result<File> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .access_mode(GENERIC_READ | GENERIC_WRITE | READ_CONTROL | WRITE_DAC)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)?;
        validate_windows_file(&file)?;
        validate_owner_and_repair_acl(&file)?;
        Ok(file)
    }

    fn validate_windows_file(file: &File) -> io::Result<()> {
        if !file.metadata()?.file_type().is_file() {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "database lock path is not a regular file",
            ));
        }
        let mut tag: FILE_ATTRIBUTE_TAG_INFO = unsafe { zeroed() };
        // SAFETY: the file handle is live and `tag` points to a correctly
        // sized writable FILE_ATTRIBUTE_TAG_INFO value.
        let ok = unsafe {
            GetFileInformationByHandleEx(
                file.as_raw_handle() as HANDLE,
                FileAttributeTagInfo,
                (&mut tag as *mut FILE_ATTRIBUTE_TAG_INFO).cast(),
                size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        if tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "database lock path is a reparse point",
            ));
        }
        Ok(())
    }

    fn validate_owner_and_repair_acl(file: &File) -> io::Result<()> {
        let mut token = null_mut();
        // SAFETY: GetCurrentProcess returns a pseudo-handle valid for this
        // call; `token` receives an owned process-token handle.
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let _token = OwnedHandle(token);

        let mut required = 0_u32;
        // The sizing call is expected to fail with an insufficient-buffer
        // status while populating `required`.
        unsafe {
            GetTokenInformation(token, TokenUser, null_mut(), 0, &mut required);
        }
        if required == 0 {
            return Err(io::Error::last_os_error());
        }
        let word = size_of::<usize>();
        let mut token_words = vec![0_usize; (required as usize).div_ceil(word)];
        // SAFETY: the aligned buffer holds at least `required` writable bytes.
        if unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                token_words.as_mut_ptr().cast(),
                required,
                &mut required,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: a successful TokenUser query returned a TOKEN_USER at the
        // start of the aligned buffer; its SID remains valid while the buffer
        // is alive.
        let user_sid = unsafe { (*(token_words.as_ptr() as *const TOKEN_USER)).User.Sid };
        if user_sid.is_null() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "current process token did not contain a user SID",
            ));
        }

        let mut owner_sid: PSID = null_mut();
        let mut security_descriptor = null_mut();
        // SAFETY: the file handle is live and the optional output pointers not
        // requested by this owner-only query are null.
        let status = unsafe {
            GetSecurityInfo(
                file.as_raw_handle() as HANDLE,
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION,
                &mut owner_sid,
                null_mut(),
                null_mut(),
                null_mut(),
                &mut security_descriptor,
            )
        };
        if status != ERROR_SUCCESS {
            return Err(io::Error::from_raw_os_error(status as i32));
        }
        if owner_sid.is_null() {
            // SAFETY: GetSecurityInfo allocated the descriptor with LocalAlloc.
            unsafe {
                LocalFree(security_descriptor);
            }
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "database lock file does not have an owner SID",
            ));
        }
        // SAFETY: both SIDs were returned by successful Windows security API
        // calls and remain live until the descriptor/buffer is released.
        let owner_matches = unsafe { EqualSid(owner_sid, user_sid) } != 0;
        // SAFETY: GetSecurityInfo allocated the descriptor with LocalAlloc.
        unsafe {
            LocalFree(security_descriptor);
        }
        if !owner_matches {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "database lock file is not owned by the effective user",
            ));
        }

        // SAFETY: user_sid came from the successful TokenUser query and is
        // still backed by token_words.
        let sid_bytes = unsafe { GetLengthSid(user_sid) as usize };
        let acl_bytes =
            size_of::<ACL>() + size_of::<ACCESS_ALLOWED_ACE>() - size_of::<u32>() + sid_bytes;
        let mut acl_storage = vec![0_u32; acl_bytes.div_ceil(size_of::<u32>())];
        let acl = acl_storage.as_mut_ptr().cast::<ACL>();
        // SAFETY: `acl_storage` is aligned and large enough for one full-access
        // ACE containing the current user SID.
        if unsafe { InitializeAcl(acl, acl_bytes as u32, ACL_REVISION) } == 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: the initialized ACL has capacity for this ACE and user_sid
        // remains valid in token_words.
        if unsafe { AddAccessAllowedAceEx(acl, ACL_REVISION, 0, FILE_ALL_ACCESS, user_sid) } == 0 {
            return Err(io::Error::last_os_error());
        }
        // Protect the DACL from inheritance and reduce it to the effective
        // user's full-control ACE, the Windows equivalent of Unix mode 0600.
        // SAFETY: `acl` is initialized and remains backed by acl_storage; the
        // file handle is live and all unrequested security fields are null.
        let status = unsafe {
            SetSecurityInfo(
                file.as_raw_handle() as HANDLE,
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                acl,
                null_mut(),
            )
        };
        if status != ERROR_SUCCESS {
            return Err(io::Error::from_raw_os_error(status as i32));
        }
        Ok(())
    }

    pub fn try_lock_exclusive(file: &File) -> io::Result<()> {
        let mut overlapped = Overlapped::lock_byte();
        let result = unsafe {
            LockFileEx(
                file.as_raw_handle() as Handle,
                LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
                0,
                1,
                0,
                &mut overlapped,
            )
        };
        if result != 0 {
            Ok(())
        } else {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(ERROR_LOCK_VIOLATION) {
                Err(io::Error::new(io::ErrorKind::WouldBlock, error))
            } else {
                Err(error)
            }
        }
    }

    pub fn unlock(file: &File) -> io::Result<()> {
        let mut overlapped = Overlapped::lock_byte();
        let result =
            unsafe { UnlockFileEx(file.as_raw_handle() as Handle, 0, 1, 0, &mut overlapped) };
        if result != 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
}

#[cfg(not(any(unix, windows)))]
mod platform {
    use std::fs::File;
    use std::io::{self, ErrorKind};
    use std::path::Path;

    pub fn open_lock_file(_path: &Path) -> io::Result<File> {
        Err(io::Error::new(
            ErrorKind::Unsupported,
            "safe database instance-lock files are not supported on this platform",
        ))
    }

    pub fn try_lock_exclusive(_file: &File) -> io::Result<()> {
        Err(io::Error::new(
            ErrorKind::Unsupported,
            "Snapback database instance locks are not supported on this platform",
        ))
    }

    pub fn unlock(_file: &File) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        DatabaseInstanceLock, FileIdentity, TargetInstanceReservation, lock_path_for_database,
        target_reservation_path_for_database,
    };

    #[test]
    fn lock_path_appends_sidecar_suffix() {
        let path = std::path::Path::new("/tmp/app.sqlite3");
        let lock_path = lock_path_for_database(path).unwrap();

        assert_eq!(
            lock_path,
            std::path::Path::new("/tmp/app.sqlite3.snapback.lock")
        );
    }

    #[test]
    fn ipv6_url_hosts_are_bracketed() {
        assert_eq!(super::url_host("::1"), "[::1]");
        assert_eq!(super::url_host("127.0.0.1"), "127.0.0.1");
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn raw_stat_identity_matches_metadata_identity() {
        use std::mem::MaybeUninit;
        use std::os::fd::AsRawFd as _;

        let file = tempfile::tempfile().expect("temporary file");
        let mut stat = MaybeUninit::<libc::stat>::uninit();
        // SAFETY: `stat` points to writable storage and `file` keeps the
        // descriptor valid for the duration of the call.
        let result = unsafe { libc::fstat(file.as_raw_fd(), stat.as_mut_ptr()) };
        assert_eq!(
            result,
            0,
            "fstat failed: {}",
            std::io::Error::last_os_error()
        );
        // SAFETY: fstat initialized `stat` after returning success.
        let stat = unsafe { stat.assume_init() };

        assert_eq!(
            FileIdentity::from_stat(&stat),
            FileIdentity::from_file(&file).expect("metadata identity")
        );
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn target_reservation_is_persistent_closed_and_never_creates_the_target_directory() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("restored").join("snapback.db");
        let lock_path = target_reservation_path_for_database(&db_path).expect("restore lock path");
        assert_eq!(lock_path, dir.path().join("restored.snapback.restore.lock"));

        let first = TargetInstanceReservation::acquire(&db_path).expect("first reservation");
        assert!(lock_path.is_file());
        assert!(!db_path.parent().unwrap().exists());

        let error = TargetInstanceReservation::acquire(&db_path)
            .expect_err("second restore reservation must fail");
        assert!(error.to_string().contains("already reserved"));
        assert!(!db_path.parent().unwrap().exists());

        drop(first);
        assert!(lock_path.is_file(), "stale lock entries are never unlinked");
        TargetInstanceReservation::acquire(&db_path).expect("closed stale record can be reused");
        assert!(!db_path.parent().unwrap().exists());
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn startup_creates_reserved_target_instance_owner_only() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("instance").join("snapback.db");
        let reservation = TargetInstanceReservation::acquire(&db_path).expect("reservation");
        let (_directory, _identity) = reservation
            .open_or_create_instance_directory_for_startup()
            .expect("owner-only target instance");

        assert_eq!(
            std::fs::metadata(db_path.parent().unwrap())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn dropping_target_reservation_unlocks_before_inherited_descriptors_close() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("restored").join("snapback.db");
        let reservation = TargetInstanceReservation::acquire(&db_path).expect("reservation");
        let inherited_descriptor = reservation
            .lock_file
            .try_clone()
            .expect("duplicate reservation descriptor");

        drop(reservation);
        let reacquired = TargetInstanceReservation::acquire(&db_path)
            .expect("guard drop explicitly unlocks before inherited descriptors close");

        drop(reacquired);
        drop(inherited_descriptor);
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn corrupt_or_hardlinked_reservation_is_rejected_without_mutation() {
        use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("restored").join("snapback.db");
        let lock_path = target_reservation_path_for_database(&db_path).unwrap();
        std::fs::write(&lock_path, b"not a reservation\n").unwrap();
        std::fs::set_permissions(&lock_path, std::fs::Permissions::from_mode(0o600)).unwrap();
        let before = std::fs::read(&lock_path).unwrap();
        TargetInstanceReservation::acquire(&db_path).expect_err("corrupt record must fail closed");
        assert_eq!(std::fs::read(&lock_path).unwrap(), before);

        std::fs::remove_file(&lock_path).unwrap();
        let source = dir.path().join("important");
        std::fs::write(&source, b"must survive").unwrap();
        std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o600)).unwrap();
        std::fs::hard_link(&source, &lock_path).unwrap();
        assert_eq!(std::fs::metadata(&source).unwrap().nlink(), 2);
        TargetInstanceReservation::acquire(&db_path).expect_err("hard link must fail closed");
        assert_eq!(std::fs::read(&source).unwrap(), b"must survive");
        assert_eq!(
            std::fs::metadata(&source).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn parent_or_lock_entry_replacement_invalidates_the_live_reservation() {
        let root = tempfile::tempdir().unwrap();
        let parent = root.path().join("parent");
        let moved = root.path().join("moved");
        std::fs::create_dir(&parent).unwrap();
        let db_path = parent.join("restored").join("snapback.db");
        let reservation = TargetInstanceReservation::acquire(&db_path).unwrap();

        std::fs::rename(&parent, &moved).unwrap();
        std::fs::create_dir(&parent).unwrap();
        assert!(reservation.ensure_valid().is_err());
        assert!(
            reservation
                .create_staging_directory(std::ffi::OsStr::new("temp"))
                .is_err()
        );

        let replacement = TargetInstanceReservation::acquire(&db_path).unwrap();
        let replacement_lock = target_reservation_path_for_database(&db_path).unwrap();
        std::fs::remove_file(&replacement_lock).unwrap();
        std::fs::write(&replacement_lock, b"replacement").unwrap();
        assert!(replacement.ensure_valid().is_err());
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn second_file_backed_owner_gets_metadata_diagnostic() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("snapback.db");
        let mut first = DatabaseInstanceLock::acquire(&db_path).expect("first lock");
        first
            .record_server("127.0.0.1", 4290)
            .expect("record server");

        let error = DatabaseInstanceLock::acquire(&db_path).expect_err("second lock fails");
        let message = error.to_string();

        assert!(first.lock_path().exists());
        assert!(message.contains("already owned by another local server"));
        assert!(message.contains("http://127.0.0.1:4290"));
        assert!(message.contains("pass --memory"));
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlink_and_non_regular_lock_paths_without_touching_targets() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("snapback.db");
        let lock_path = lock_path_for_database(&db_path).expect("lock path");
        let target = dir.path().join("must-survive");
        std::fs::write(&target, b"must-survive").expect("target fixture");
        std::os::unix::fs::symlink(&target, &lock_path).expect("symlink fixture");

        let error = DatabaseInstanceLock::acquire(&db_path).expect_err("symlink must fail");
        assert!(error.to_string().contains("safe Snapback database lock"));
        assert_eq!(
            std::fs::read(&target).expect("target bytes"),
            b"must-survive"
        );

        std::fs::remove_file(&lock_path).expect("remove symlink");
        std::fs::create_dir(&lock_path).expect("directory fixture");
        DatabaseInstanceLock::acquire(&db_path).expect_err("non-regular path must fail");
    }

    #[cfg(unix)]
    #[test]
    fn safe_existing_lock_is_owner_only_and_wrong_owner_is_rejected() {
        use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("snapback.db");
        let lock_path = lock_path_for_database(&db_path).expect("lock path");
        std::fs::write(&lock_path, b"stale metadata").expect("existing lock fixture");
        std::fs::set_permissions(&lock_path, std::fs::Permissions::from_mode(0o666))
            .expect("permissive fixture");

        let lock = DatabaseInstanceLock::acquire(&db_path).expect("safe existing lock");
        let metadata = std::fs::metadata(&lock_path).expect("lock metadata");
        assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
        let owner = metadata.uid();
        let wrong_owner = owner.wrapping_add(1);
        assert!(
            super::platform::validate_for_effective_uid(&lock.file, wrong_owner).is_err(),
            "an opened inode owned by another identity must fail closed"
        );
    }
}
