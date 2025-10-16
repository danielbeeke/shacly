import { RdfStore } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
import { useMemo } from "react";
import { Parser } from "n3";
import { useLocalStorage } from "@uidotdev/usehooks";
import { getPropertyValues } from "./getPropertyValues";
import type { NamedNode, Quad_Subject } from "@rdfjs/types";
const DF = new DataFactory();

const examples = {
  "DCAT AP EU": {
    shapes: "https://semiceu.github.io/DCAT-AP/releases/3.0.0/shacl/dcat-ap-SHACL.ttl",
    data: undefined,
    focusNode: undefined,
  },

  "SKOS AP NL": {
    shapes: "https://raw.githubusercontent.com/Geonovum/NL-SBB/refs/heads/main/profiles/skos-ap-nl.ttl",
    data: "https://repository.officiele-overheidspublicaties.nl/waardelijsten/scw_betrokkenheid/1/ttl/scw_betrokkenheid_1.ttl",
    focusNode: "https://identifier.overheid.nl/tooi/def/thes/kern/c_8170d2d5",
  },
};

export default function PropertyValueDemo() {
  const [focusNode, setFocusNode] = useLocalStorage<string>("property-value-focus-node", "");
  const [shapesTurtle, setShapesTurtle] = useLocalStorage<string>("property-value-shapes-turtle", "");

  const [dataTurtle, setDataTurtle] = useLocalStorage<string>("property-value-data-turtle", "");

  const { propertyValues, subjects } = useMemo(() => {
    const newShapesStore = RdfStore.createDefault();
    try {
      const shapesParser = new Parser({
        format: "text/turtle",
        factory: DF,
      });
      const shapesQuads = shapesParser.parse(shapesTurtle);
      for (const quad of shapesQuads) newShapesStore.addQuad(quad);
    } catch (error) {
      console.error("Error parsing shapes turtle:", error);
    }

    const newDataStore = RdfStore.createDefault();
    try {
      const dataParser = new Parser({
        format: "text/turtle",
        factory: DF,
      });
      const dataQuads = dataParser.parse(dataTurtle);
      for (const quad of dataQuads) newDataStore.addQuad(quad);
    } catch (error) {
      console.error("Error parsing data turtle:", error);
    }

    const subjects: Map<string, Quad_Subject> = new Map();
    for (const quad of newDataStore.getQuads()) {
      subjects.set(quad.subject.value, quad.subject);
    }

    return {
      propertyValues: getPropertyValues({
        focusNode: focusNode ? subjects.get(focusNode) : undefined,
        shapesGraph: newShapesStore,
        dataGraph: newDataStore,
      }),
      subjects: [...subjects.values()],
    };
  }, [shapesTurtle, dataTurtle, focusNode]);

  return (
    <div>
      <select>
        <option value="">-- Select an example --</option>
        {Object.entries(examples).map(([name, urls]) => (
          <option
            key={name}
            value={name}
            onClick={async () => {
              if (urls.shapes) {
                const shapesResponse = await fetch(urls.shapes);
                const shapesText = await shapesResponse.text();
                setShapesTurtle(shapesText);
              }

              if (urls.data) {
                const dataResponse = await fetch(urls.data);
                const dataText = await dataResponse.text();
                setDataTurtle(dataText);
              } else {
                setDataTurtle("");
              }

              if (urls.focusNode) {
                setFocusNode(urls.focusNode);
              } else {
                setFocusNode("");
              }
            }}
          >
            {name}
          </option>
        ))}
      </select>

      <select value={focusNode} onChange={(event) => setFocusNode(event.target.value)}>
        {subjects.map((subject) => (
          <option key={subject.value} value={subject.value}>
            {subject.value}
          </option>
        ))}
      </select>

      <textarea value={shapesTurtle} onChange={(e) => setShapesTurtle(e.target.value)}></textarea>

      <textarea value={dataTurtle} onChange={(e) => setDataTurtle(e.target.value)}></textarea>
    </div>
  );
}
