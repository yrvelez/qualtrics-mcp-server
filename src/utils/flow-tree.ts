export type FlowElement = Record<string, any>;

export type FlowPlacement =
  | "beginning"
  | "end"
  | "before"
  | "after"
  | "inside_beginning"
  | "inside_end";

interface FlowLocation {
  elements: FlowElement[];
  index: number;
  element: FlowElement;
}

/** Return the root flow definition and every nested flow element. */
export function flowNodes(flow: FlowElement): FlowElement[] {
  const nodes: FlowElement[] = [flow];
  if (Array.isArray(flow.Flow)) {
    walkFlow(flow.Flow, (element) => nodes.push(element));
  }
  return nodes;
}

export function walkFlow(
  elements: FlowElement[],
  visitor: (element: FlowElement) => void
): void {
  for (const element of elements) {
    visitor(element);
    if (Array.isArray(element.Flow)) walkFlow(element.Flow, visitor);
  }
}

export function findFlowLocation(
  elements: FlowElement[],
  flowId: string
): FlowLocation | null {
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    if (element.FlowID === flowId) return { elements, index, element };
    if (Array.isArray(element.Flow)) {
      const nested = findFlowLocation(element.Flow, flowId);
      if (nested) return nested;
    }
  }
  return null;
}

export function allFlowIds(flow: Record<string, any>): string[] {
  return flowNodes(flow)
    .map((element) => element.FlowID)
    .filter((flowId): flowId is string => typeof flowId === "string");
}

export function maxFlowNumber(flow: Record<string, any>): number {
  let max = 0;
  for (const id of allFlowIds(flow)) {
    const match = /^FL_(\d+)$/.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

export function allocateFlowId(flow: Record<string, any>): string {
  const propertyCount = Number(flow.Properties?.Count) || 0;
  return `FL_${Math.max(propertyCount, maxFlowNumber(flow)) + 1}`;
}

export function normalizeFlowCount(flow: Record<string, any>): number {
  flow.Properties ??= {};
  const max = maxFlowNumber(flow);
  flow.Properties.Count = max;
  return max;
}

export function insertFlowElements(
  flow: Record<string, any>,
  newElements: FlowElement[],
  placement: FlowPlacement,
  referenceFlowId?: string
): void {
  flow.Flow ??= [];
  if (!Array.isArray(flow.Flow)) throw new Error("The survey flow's Flow property is not an array.");

  if (placement === "beginning") {
    flow.Flow.unshift(...newElements);
    return;
  }
  if (placement === "end") {
    flow.Flow.push(...newElements);
    return;
  }
  if (!referenceFlowId) {
    throw new Error(`referenceFlowId is required when placement is '${placement}'.`);
  }

  const location = findFlowLocation(flow.Flow, referenceFlowId);
  if (!location) throw new Error(`Flow element '${referenceFlowId}' was not found.`);

  if (placement === "before") {
    location.elements.splice(location.index, 0, ...newElements);
  } else if (placement === "after") {
    location.elements.splice(location.index + 1, 0, ...newElements);
  } else {
    if (location.element.Flow !== undefined && !Array.isArray(location.element.Flow)) {
      throw new Error(`Flow element '${referenceFlowId}' has a non-array Flow property.`);
    }
    location.element.Flow ??= [];
    if (placement === "inside_beginning") location.element.Flow.unshift(...newElements);
    else location.element.Flow.push(...newElements);
  }
}

export function removeFlowElement(
  flow: Record<string, any>,
  flowId: string
): FlowElement | null {
  const root = Array.isArray(flow.Flow) ? flow.Flow : [];
  const location = findFlowLocation(root, flowId);
  if (!location) return null;
  return location.elements.splice(location.index, 1)[0] ?? null;
}
