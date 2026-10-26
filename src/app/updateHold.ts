/** Exports in progress: an app update reloads the page, so the app never looks for one meanwhile. */
let held = 0;

export function holdUpdates(): () => void {
  held++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held--;
  };
}

export function updatesHeld(): boolean {
  return held > 0;
}
