import type { NamedNode, Quad, Quad_Predicate, Quad_Subject, Term } from "@rdfjs/types";
import type { RdfStore } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
const DF = new DataFactory();

export const sh = (localName: string = "") => DF.namedNode("http://www.w3.org/ns/shacl#" + localName);
export const rdf = (localName: string = "") => DF.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#" + localName);
export const rdfs = (localName: string = "") => DF.namedNode("http://www.w3.org/2000/01/rdf-schema#" + localName);
export const skos = (localName: string = "") => DF.namedNode("http://www.w3.org/2004/02/skos/core#" + localName);

type Options = {
  focusNode?: Term;
  shapesGraph?: RdfStore;
  dataGraph?: RdfStore;
};

export type PropertyValue = {
  path: Quad_Predicate[];
  valueNodes: Quad[];
  property: Quad[];
  type: "shape" | "data";
  shapesGraph?: RdfStore;
};

/**
 * What is a property value? See https://github.com/w3c/data-shapes/blob/agenda/ui-tf/meetings/2025-09-30.md
 * What about triples for which no shape is defined?
 */
export function getPropertyValues({ focusNode, shapesGraph, dataGraph }: Options): PropertyValue[] {
  const targetShapes = getTargetShapes({ focusNode, shapesGraph, dataGraph });

  const propertyValues: PropertyValue[] = [];
  const subjects: Map<string, Term> = new Map();

  for (const targetShape of targetShapes) {
    if (targetShape.focusNode) subjects.set(targetShape.focusNode.value, targetShape.focusNode);
    const nodeShapeQuads = shapesGraph?.getQuads(targetShape.shapeIri, sh("node"), null) ?? [];
    const andShapeQuads = shapesGraph?.getQuads(targetShape.shapeIri, sh("and"), null) ?? [];
    const parentShapeQuads = [
      targetShape.shapeIri,
      ...nodeShapeQuads.map((quad) => quad.object),
      ...andShapeQuads.map((quad) => quad.object),
    ];
    for (const parentShapeQuad of parentShapeQuads) {
      const propertyShapeQuads = shapesGraph?.getQuads(parentShapeQuad, sh("property"), null) ?? [];
      for (const propertyShapeQuad of propertyShapeQuads) {
        const propertyQuads = shapesGraph?.getQuads(propertyShapeQuad.object) ?? [];
        const pathStartQuad = shapesGraph?.getQuads(propertyShapeQuad.object, sh("path"), null)[0];
        if (!pathStartQuad || !shapesGraph) continue;
        const path = extractPath(pathStartQuad, shapesGraph);
        if (path.length !== 1) throw new Error("Only single predicate paths are supported for now");
        const valueNodes = dataGraph?.getQuads(targetShape.focusNode, path[0], null) ?? [];
        propertyValues.push({ path, valueNodes, property: propertyQuads, shapesGraph, type: "shape" });
      }
    }
  }

  for (const subject of [...subjects.values(), focusNode].filter(Boolean) as Term[]) {
    const allSubjectQuads = dataGraph?.getQuads(subject, null, null) ?? [];
    const allSubjectQuadsGrouped = new Map<string, Quad[]>();
    for (const quad of allSubjectQuads) {
      const quadsForPredicate = allSubjectQuadsGrouped.get(quad.predicate.value) ?? [];
      quadsForPredicate.push(quad);
      allSubjectQuadsGrouped.set(quad.predicate.value, quadsForPredicate);
    }

    for (const [predicate, quads] of allSubjectQuadsGrouped) {
      const hasShape = propertyValues.find((pv) => pv.path[0].equals(DF.namedNode(predicate)));
      if (!hasShape) {
        propertyValues.push({
          path: [DF.namedNode(predicate)],
          valueNodes: quads,
          property: [],
          shapesGraph,
          type: "data",
        });
      }
    }
  }

  return propertyValues.toSorted((a, b) => {
    const aOrder = a.property.find((quad) => quad.predicate.equals(sh("order")))?.object.value;
    const bOrder = b.property.find((quad) => quad.predicate.equals(sh("order")))?.object.value;
    if (aOrder && bOrder) return parseInt(aOrder) - parseInt(bOrder);
    if (aOrder) return -1;
    if (bOrder) return 1;
    const aLabel = a.property.find((quad) => quad.predicate.equals(rdfs("label")))?.object.value ?? "";
    const bLabel = b.property.find((quad) => quad.predicate.equals(rdfs("label")))?.object.value ?? "";
    return aLabel.localeCompare(bLabel);
  });
}

export function extractPath(pathQuad: Quad, shapesGraph: RdfStore): Quad_Predicate[] {
  const lists = [rdf("first"), rdf("rest")];
  const variants = [
    sh("alternativePath"),
    sh("zeroOrMorePath"),
    sh("oneOrMorePath"),
    sh("zeroOrOnePath"),
    sh("inversePath"),
  ];
  const continuePredicates = [...lists, ...variants];

  const trail: Quad_Predicate[] = [];
  trail.push(pathQuad.object as Quad_Predicate);

  let lastTerm: Term | null = pathQuad.object;

  while (lastTerm) {
    const [child] = shapesGraph.getQuads(lastTerm);
    if (!child) {
      lastTerm = null;
      continue;
    }
    trail.push(child.object as Quad_Predicate);
    const childEndsWithBlankNode = child.object.termType === "BlankNode" || child.object.value.includes("/genid/");
    const shouldContinue = continuePredicates.some((predicate) => child.predicate.equals(predicate));
    lastTerm = childEndsWithBlankNode || shouldContinue ? child.object : null;
  }

  return trail;
}

export type TargetShapeMatch = {
  focusNode?: Term;
  shapeIri: Quad_Subject;
};

// See https://w3c.github.io/data-shapes/shacl/#targets
export function getTargetShapes({ focusNode, shapesGraph, dataGraph }: Options): TargetShapeMatch[] {
  const matches: TargetShapeMatch[] = [];

  // 3.1.3.1 Node targets (sh:targetNode)
  const targetNodesQuads = shapesGraph?.getQuads(null, sh("targetNode"), focusNode) ?? [];
  for (const targetNodeQuad of targetNodesQuads) {
    matches.push({
      focusNode: targetNodeQuad.object,
      shapeIri: targetNodeQuad.subject,
    });
  }

  // 3.1.3.2 Class-based Targets (sh:targetClass)
  const targetClassQuads = shapesGraph?.getQuads(null, sh("targetClass"), null) ?? [];
  for (const targetClassQuad of targetClassQuads) {
    const dataWithTargetClassQuads = dataGraph?.getQuads(focusNode, rdf("type"), targetClassQuad.object) ?? [];

    for (const dataWithTargetClassQuad of dataWithTargetClassQuads) {
      matches.push({
        focusNode: dataWithTargetClassQuad.subject,
        shapeIri: targetClassQuad.subject,
      });
    }
  }

  // 3.1.3.3 Implicit Class Targets and sh:ShapeClass
  const possibleImplicitClassQuads = shapesGraph?.getQuads(null, rdf("type"), rdfs("Class")) ?? [];
  const implicitClassQuads = possibleImplicitClassQuads.filter((quad) => {
    const classQuads = shapesGraph?.getQuads(quad.subject, rdf("type"), sh("NodeShape")) ?? [];
    return classQuads.length > 0;
  });
  const shapeClassQuads = shapesGraph?.getQuads(null, rdf("type"), sh("ShapeClass")) ?? [];

  for (const implicitClassQuad of [...implicitClassQuads, ...shapeClassQuads]) {
    const matchingDataQuads = dataGraph?.getQuads(null, rdf("type"), implicitClassQuad.subject) ?? [];
    for (const matchingDataQuad of matchingDataQuads) {
      matches.push({
        focusNode: matchingDataQuad.subject,
        shapeIri: implicitClassQuad.subject,
      });
    }
  }

  // 3.1.3.4 Subjects-of targets (sh:targetSubjectsOf)
  const targetSubjectsOfQuads = shapesGraph?.getQuads(null, sh("targetSubjectsOf")) ?? [];
  for (const targetSubjectsOfQuad of targetSubjectsOfQuads) {
    const matchingDataQuads = dataGraph?.getQuads(focusNode, targetSubjectsOfQuad.object, null) ?? [];
    for (const matchingDataQuad of matchingDataQuads) {
      matches.push({
        focusNode: matchingDataQuad.subject,
        shapeIri: targetSubjectsOfQuad.subject,
      });
    }
  }

  // 3.1.3.5 Objects-of targets (sh:targetObjectsOf)
  const targetObjectsOfQuads = shapesGraph?.getQuads(null, sh("targetObjectsOf")) ?? [];
  for (const targetObjectsOfQuad of targetObjectsOfQuads) {
    const matchingDataQuads = dataGraph?.getQuads(focusNode, targetObjectsOfQuad.object, null) ?? [];
    for (const matchingDataQuad of matchingDataQuads) {
      matches.push({
        focusNode: matchingDataQuad.object,
        shapeIri: targetObjectsOfQuad.subject,
      });
    }
  }

  // 3.1.3.6 Where Targets (sh:targetWhere) TODO we would need a SHACL engine for this

  // 3.1.3.7 Explicit shape targets (sh:shape)
  const explicitShapeQuads = shapesGraph?.getQuads(focusNode, sh("shape")) ?? [];
  for (const explicitShapeQuad of explicitShapeQuads) {
    matches.push({
      focusNode: explicitShapeQuad.subject,
      shapeIri: explicitShapeQuad.object as NamedNode,
    });
  }

  if (focusNode) {
    return matches.filter((match) => match.focusNode?.equals(focusNode));
  }

  return matches;
}
