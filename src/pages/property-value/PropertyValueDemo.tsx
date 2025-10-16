import { RdfStore } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
import { useMemo } from "react";
import { Parser } from "n3";
import { useLocalStorage } from "@uidotdev/usehooks";
import { getPropertyValues, rdfs } from "./getPropertyValues";
import type { Quad_Subject, Term } from "@rdfjs/types";
import type { PropertyValue } from "./getPropertyValues";
const DF = new DataFactory();
import "./styles.scss";
import { JsonLdContextNormalized } from "jsonld-context-parser";

const examples = {
  "DCAT AP EU": {
    shapes: "https://semiceu.github.io/DCAT-AP/releases/3.0.0/shacl/dcat-ap-SHACL.ttl",
    data: "https://w3c.github.io/dxwg/dcat/examples/vocab-dcat-3/csiro-dap-examples.ttl",
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

  const [showEmptyPropertyValues, setShowEmptyPropertyValues] = useLocalStorage<boolean>(
    "property-value-show-empty",
    false,
  );

  const { propertyValues, subjects, context } = useMemo(() => {
    const prefixes = {};
    const newShapesStore = RdfStore.createDefault();
    try {
      const shapesParser = new Parser({
        format: "text/turtle",
        factory: DF,
      });
      const shapesQuads = shapesParser.parse(shapesTurtle);
      for (const quad of shapesQuads) newShapesStore.addQuad(quad);
      /** @ts-expect-error internal */
      Object.assign(prefixes, shapesParser._prefixes);
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
      /** @ts-expect-error internal */
      Object.assign(prefixes, dataParser._prefixes);
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
      prefixes,
      context: new JsonLdContextNormalized({ prefixes }),
      subjects: [...subjects.values()],
    };
  }, [shapesTurtle, dataTurtle, focusNode]);

  const filteredPropertyValues = showEmptyPropertyValues
    ? propertyValues
    : propertyValues.filter((pv) => pv.valueNodes.length > 0);

  return (
    <div className="property-value-demo">
      <div className="fields">
        <div className="field">
          <label className="label">Example:</label>
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
        </div>

        <div className="field">
          <label className="label">Focus Node:</label>
          <select value={focusNode} onChange={(event) => setFocusNode(event.target.value)}>
            {subjects.map((subject) => (
              <option key={subject.value} value={subject.value}>
                {subject.value}
              </option>
            ))}
          </select>
        </div>

        <div className="field grow">
          <label className="label">Shapes Turtle:</label>
          <textarea value={shapesTurtle} onChange={(e) => setShapesTurtle(e.target.value)}></textarea>
        </div>

        <div className="field grow">
          <label className="label">Data Turtle:</label>
          <textarea value={dataTurtle} onChange={(e) => setDataTurtle(e.target.value)}></textarea>
        </div>
      </div>

      <output>
        <h2>Property Values</h2>
        <div className="field">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={showEmptyPropertyValues}
              onChange={(e) => setShowEmptyPropertyValues(e.target.checked)}
            />
            Show empty property values
          </label>
        </div>
        {filteredPropertyValues.map((pv, index) => (
          <PropertyValueElement key={index} {...pv} context={context} />
        ))}
      </output>
    </div>
  );
}

function PropertyValueElement({
  path,
  type,
  valueNodes,
  shapes,
  context,
  dataGraph,
}: PropertyValue & { context: JsonLdContextNormalized }) {
  console.log(shapes);
  const labels = shapes
    .flat()
    .filter((quad) => quad.predicate.equals(rdfs("label")))
    .map((quad) => quad.object);
  const label =
    labels.find((l) => l.termType === "Literal" && l.language === "en")?.value ??
    labels.find((l) => l.termType === "Literal" && l.language === "nl")?.value ??
    labels.find((l) => l.termType === "Literal" && l.language === "")?.value ??
    path.at(-1)?.value.split(/\/|#/).pop() ??
    "Unknown property";

  return (
    <div className="field">
      <label className="label" title={path[0].value}>
        {label} <em className="type">{type}</em>
      </label>
      <div className="value">
        {valueNodes.map((valueNode) => (
          <Term key={valueNode.object.value} {...valueNode.object} dataGraph={dataGraph} context={context} />
        ))}
      </div>
    </div>
  );
}

function Term({ context, dataGraph, ...term }: Term & { context: JsonLdContextNormalized; dataGraph?: RdfStore }) {
  const { value, termType } = term;
  if (termType === "Literal") {
    return <span className="term literal">{value}</span>;
  }
  if (termType === "BlankNode") {
    const children = dataGraph?.getQuads(term, null, null) ?? [];
    if (children.length > 0) {
      return children.map((quad) => (
        <div key={JSON.stringify(quad)} className="blank-node-property">
          <label className="label">{quad.predicate.value.split(/\/|#/g).pop()!}</label>: &nbsp;
          <Term {...quad.object} context={context} dataGraph={dataGraph} />
        </div>
      ));
    } else {
      return <span className="term blank-node">{value}</span>;
    }
  }
  if (termType === "NamedNode") {
    return (
      <a className="term named-node" href={value} target="_blank" rel="noreferrer">
        {context.compactIri(value, true)}
      </a>
    );
  }
}
