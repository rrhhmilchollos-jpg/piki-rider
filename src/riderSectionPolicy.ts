/** The operational map is exclusive to the delivery home/journey surface. */
export function shouldShowOperationalMap(section: string) {
  return section === "Inicio";
}

/**
 * A map may render before a shift starts, but it must not request device
 * location until the rider is actually operating. Starting a shift performs
 * its own explicit, user-initiated GPS check in App.
 */
export function shouldTrackLocationOnOperationalMap(
  section: string,
  shiftActive: boolean,
) {
  return shiftActive && shouldShowOperationalMap(section);
}

/** Non-operational navigation must never be hidden behind the GPS gate. */
export function canAccessSectionWithoutLocation(section: string) {
  return !shouldShowOperationalMap(section);
}
