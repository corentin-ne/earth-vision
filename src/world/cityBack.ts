import { useWorld } from './store';
import { useCityUi } from './cityUi';
import { openCity } from './city';

/** Esc and the Android back button in a city: out of what is in hand first, out of the city last. False when no city is open. */
export function back(): boolean {
  if (useWorld.getState().cityView == null) return false;
  const ui = useCityUi.getState();
  // Leaving a tool drops what was being drawn with it.
  if (ui.tool !== 'pick') useCityUi.setState({ tool: 'pick' });
  else if (ui.station) useCityUi.setState({ station: null });
  else if (ui.district) useCityUi.setState({ district: null });
  else if (ui.line) useCityUi.setState({ line: null });
  else openCity(null);
  return true;
}
