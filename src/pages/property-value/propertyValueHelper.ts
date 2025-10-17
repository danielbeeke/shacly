import { rdfs, sh, type PropertyValue } from "./getPropertyValues";

export const propertyValueHelper = (propertyValue: PropertyValue) => {
  return {
    get label() {
      const labels = propertyValue.shapes
        .flat()
        .filter((quad) => quad.predicate.equals(sh("name")) || quad.predicate.equals(rdfs("label")))
        .map((quad) => quad.object);
      return (
        labels.find((l) => l.termType === "Literal" && l.language === "en")?.value ??
        labels.find((l) => l.termType === "Literal" && l.language === "nl")?.value ??
        labels.find((l) => l.termType === "Literal" && l.language === "")?.value ??
        propertyValue.path.at(-1)?.value.split(/\/|#/).pop() ??
        "Unknown property"
      );
    },
    get minCount() {
      const counts = propertyValue.shapes
        .flat()
        .filter((quad) => quad.predicate.equals(sh("minCount")))
        .map((quad) => parseFloat(quad.object.value));

      const minCount = Math.max(...counts);
      return minCount === -Infinity ? undefined : minCount;
    },
    get maxCount() {
      const counts = propertyValue.shapes
        .flat()
        .filter((quad) => quad.predicate.equals(sh("maxCount")))
        .map((quad) => parseFloat(quad.object.value));

      const maxCount = Math.min(...counts);
      return maxCount === Infinity ? undefined : maxCount;
    },
  };
};
