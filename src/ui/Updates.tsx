// The update banner (Android, when a newer release is out) and the "check for updates" row of
// the Advanced panel and the home screen.
import { APP_VERSION, checkForUpdates, dismissUpdate, openRelease, useUpdates } from '../io/updates';
import { isNative } from '../native';
import { Icon } from './icons';

export function UpdateBanner() {
  const s = useUpdates();
  if (!s.banner || s.status !== 'available') return null;
  return (
    <div className="update-banner glass" role="status">
      <span className="update-icon">
        <Icon name="download" size={18} />
      </span>
      <span className="grow">
        <strong>Earth Vision {s.latest.version} is out</strong>
        <small>You have {APP_VERSION} · your worlds stay as they are</small>
      </span>
      <button className="btn primary small" onClick={() => openRelease(s.latest)}>
        Download
      </button>
      <button className="icon-btn" onClick={dismissUpdate} title="Not now">
        <Icon name="x" size={15} />
      </button>
    </div>
  );
}

/** Version, a check button and what the last check found. */
export function UpdateRow() {
  const s = useUpdates();
  const status =
    s.status === 'checking'
      ? 'Checking GitHub…'
      : s.status === 'current'
        ? 'You have the latest version'
        : s.status === 'available'
          ? `Version ${s.latest.version} is available`
          : s.status === 'error'
            ? `Couldn't check: ${s.message}`
            : isNative
              ? 'Checked automatically when the app opens'
              : 'The web version updates itself';
  return (
    <div className={'update-row' + (s.status === 'available' ? ' has-update' : '')}>
      <span className="grow">
        <strong>Earth Vision {APP_VERSION}</strong>
        <small>{status}</small>
      </span>
      {s.status === 'available' ? (
        <button className="btn primary small" onClick={() => openRelease(s.latest)}>
          <Icon name="download" size={14} /> {isNative ? 'Download' : 'See release'}
        </button>
      ) : (
        <button className="btn small" disabled={s.status === 'checking'} onClick={() => void checkForUpdates()}>
          <Icon name="sparkle" size={14} /> Check for updates
        </button>
      )}
    </div>
  );
}
