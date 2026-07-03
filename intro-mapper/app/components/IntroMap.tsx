"use client";

import { useMemo } from "react";
import ReactFlow, { Background, Controls, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import type { IntroPath, Person } from "@/lib/shared";

const TARGET = "#fa4616";
const CONFIRMED = "#3ecf8e";
const LIKELY = "#f5b544";
const TEAM = "#8a8a92";

/**
 * Interactive intro map. Renders the target in the center with each ranked
 * connector fanning out, and the teammate who reaches them behind. Confirmed
 * paths are drawn solid; inferred (likely) paths are dashed.
 */
export function IntroMap({
  target,
  paths,
  personName,
}: {
  target: Person;
  paths: IntroPath[];
  personName: (id: string) => string;
}) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const top = paths.slice(0, 8);

    nodes.push({
      id: target.id,
      position: { x: 420, y: 40 + top.length * 26 },
      data: { label: `\uD83C\uDFAF ${target.name}` },
      style: nodeStyle(TARGET, true),
      sourcePosition: "left" as any,
      targetPosition: "left" as any,
    });

    const seenTeam = new Map<string, number>();
    top.forEach((p, i) => {
      const y = 40 + i * 70;
      nodes.push({
        id: p.connectorId,
        position: { x: 220, y },
        data: { label: `${personName(p.connectorId)}\n${p.breakdown.composite}` },
        style: nodeStyle(p.veracity === "confirmed" ? CONFIRMED : LIKELY, false),
      });
      edges.push({
        id: `c-${p.connectorId}`,
        source: p.connectorId,
        target: target.id,
        animated: p.veracity === "confirmed",
        style: { stroke: p.veracity === "confirmed" ? CONFIRMED : LIKELY, strokeDasharray: p.veracity === "confirmed" ? undefined : "6 4" },
        label: p.veracity,
      });

      if (p.viaTeamMemberId !== p.connectorId) {
        if (!seenTeam.has(p.viaTeamMemberId)) {
          seenTeam.set(p.viaTeamMemberId, seenTeam.size);
          nodes.push({
            id: `team-${p.viaTeamMemberId}`,
            position: { x: 20, y: 40 + seenTeam.get(p.viaTeamMemberId)! * 90 },
            data: { label: `\uD83D\uDC64 ${personName(p.viaTeamMemberId)}` },
            style: nodeStyle(TEAM, false),
          });
        }
        edges.push({
          id: `t-${p.viaTeamMemberId}-${p.connectorId}`,
          source: `team-${p.viaTeamMemberId}`,
          target: p.connectorId,
          style: { stroke: "#3a3a3f" },
        });
      }
    });

    return { nodes, edges };
  }, [target, paths, personName]);

  return (
    <div className="mapwrap">
      <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
        <Background color="#2a2a2e" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function nodeStyle(color: string, big: boolean): React.CSSProperties {
  return {
    background: "#1c1c1f",
    color: "#ededee",
    border: `1.5px solid ${color}`,
    borderRadius: 10,
    padding: big ? "10px 16px" : "8px 12px",
    fontSize: big ? 14 : 12,
    fontWeight: 600,
    whiteSpace: "pre-line",
    textAlign: "center",
  };
}
