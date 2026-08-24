import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "../components/ui/StatusPill";
import { StateStepper } from "../components/ui/StateStepper";
import { EmptyState, ErrorPanel } from "../components/ui/Feedback";
import { Timeline } from "../components/ui/Timeline";

describe("UI primitives (F2)", () => {
  it("maps known statuses to colored pills", () => {
    render(<StatusPill value="DELIVERED" />);
    const pill = screen.getByText("DELIVERED");
    expect(pill).toBeInTheDocument();
  });

  it("renders a neutral badge for unknown status values instead of crashing", () => {
    render(<StatusPill value="SOMETHING_NEW" />);
    expect(screen.getByText(/SOMETHING NEW/i)).toBeInTheDocument();
  });

  it("renders em dash for null status", () => {
    render(<StatusPill value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("StateStepper renders all states and highlights current", () => {
    render(<StateStepper current="QKD_RUNNING" />);
    expect(screen.getByRole("list", { name: /communication state/i })).toBeInTheDocument();
    expect(screen.getByText(/QKD RUNNING/i)).toBeInTheDocument();
  });

  it("EmptyState shows title and hint", () => {
    render(<EmptyState title="Nothing here" hint="Try again later" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByText("Try again later")).toBeInTheDocument();
  });

  it("ErrorPanel exposes role=alert and retry", async () => {
    let clicked = false;
    render(<ErrorPanel message="Boom" code="INTERNAL_ERROR" onRetry={() => (clicked = true)} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await screen.findByText("Retry").then((btn) => btn.click());
    expect(clicked).toBe(true);
  });

  it("Timeline shows placeholder when empty and entries when fed", () => {
    const { rerender } = render(<Timeline entries={[]} />);
    expect(screen.getByText(/awaiting first event/i)).toBeInTheDocument();
    rerender(
      <Timeline
        entries={[
          {
            type: "communication.state_changed",
            state: "CREATED",
            timestamp: "2026-08-22T10:15:00Z",
          },
        ]}
      />,
    );
    expect(screen.getByText("communication.state_changed")).toBeInTheDocument();
  });
});
