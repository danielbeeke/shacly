import type { NamedNode, Quad, Quad_Predicate, Quad_Subject, Term } from "@rdfjs/types";
import type { RdfStore } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
import { groupBy } from "./helpers";
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
  focusNode?: Term;
  path: Quad_Predicate[];
  valueNodes: Quad[];
  shapes: Quad[][];
  type: "shape" | "data";
  shapesGraph?: RdfStore;
  dataGraph?: RdfStore;
};

export type TargetShapeMatch = {
  focusNode: Term;
  shapeIri: Quad_Subject;
};

/**
 * What is a property value? See https://github.com/w3c/data-shapes/blob/agenda/ui-tf/meetings/2025-09-30.md
 * What about triples for which no shape is defined?
 */
export function getPropertyValues({ focusNode, shapesGraph, dataGraph }: Options): PropertyValue[] {
  const targetShapes = getTargetShapes({ focusNode, shapesGraph, dataGraph });

  const propertyValues: PropertyValue[] = [];
  const subjects = [focusNode].filter(Boolean) as Term[];
  const targetShapesGroupedByFocusNode = groupBy(
    [
      ...targetShapes,
      {
        focusNode,
        shapeIri: undefined,
      },
    ],
    // We need to go through the next for of loop, evening if no shapes match.
    (ts) => ts.focusNode?.value ?? "_data_only",
  );

  for (const [focusNode, targetShapes] of targetShapesGroupedByFocusNode) {
    const focusNodeTerm = focusNode === "_data_only" ? undefined : DF.namedNode(focusNode);
    if (focusNodeTerm && !subjects.find((s) => s.equals(focusNodeTerm))) subjects.push(focusNodeTerm);

    const shapesPerPath = new Map();

    for (const targetShape of targetShapes) {
      const nodeShapeQuads = targetShape.shapeIri
        ? (shapesGraph?.getQuads(targetShape.shapeIri, sh("node")) ?? [])
        : [];
      const andShapeQuads = targetShape.shapeIri ? (shapesGraph?.getQuads(targetShape.shapeIri, sh("and")) ?? []) : [];
      const parentShapeQuads = targetShape
        ? [
            targetShape.shapeIri,
            ...nodeShapeQuads.map((quad) => quad.object),
            ...andShapeQuads.map((quad) => quad.object),
          ]
        : [];
      for (const parentShapeQuad of parentShapeQuads) {
        const propertyShapeQuads = shapesGraph?.getQuads(parentShapeQuad, sh("property")) ?? [];
        for (const propertyShapeQuad of propertyShapeQuads) {
          const pathQuad = shapesGraph?.getQuads(propertyShapeQuad.object, sh("path"))[0];
          const propertyShapeQuadsProperties = shapesGraph?.getQuads(propertyShapeQuad.object) ?? [];
          if (!pathQuad) continue;
          const predicate = pathQuad.object.value;
          const pathShapes = shapesPerPath.get(predicate) ?? [];
          shapesPerPath.set(predicate, [...pathShapes, propertyShapeQuadsProperties]);
        }
      }
    }

    for (const subject of [...subjects.values()]) {
      const allSubjectQuads = dataGraph?.getQuads(subject) ?? [];
      const allSubjectQuadsGroupedByPredicate = groupBy(allSubjectQuads, (quad) => quad.predicate.value);

      for (const [predicate] of allSubjectQuadsGroupedByPredicate) {
        const hasShape = propertyValues.find((pv) => pv.path[0].equals(DF.namedNode(predicate)));
        if (!hasShape) {
          if (!shapesPerPath.has(predicate)) shapesPerPath.set(predicate, []);
        }
      }
    }

    for (const [pathValue, shapes] of shapesPerPath) {
      const path = [DF.namedNode(pathValue)];
      const valueNodes = focusNodeTerm
        ? (dataGraph?.getQuads(DF.namedNode(focusNode), DF.namedNode(pathValue)) ?? [])
        : [];
      propertyValues.push({
        focusNode: focusNodeTerm,
        path,
        valueNodes,
        shapes,
        type: shapes.length ? ("shape" as const) : ("data" as const),
        shapesGraph,
        dataGraph,
      });
    }
  }

  return propertyValues;
}

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
