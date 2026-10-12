/** The operational map is exclusive to the delivery home/journey surface. */
export function shouldShowOperationalMap(section: string) {
  return section === "Inicio";
}
