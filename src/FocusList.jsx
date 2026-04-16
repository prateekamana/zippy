import { useState, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export const FOCUS_KEY = "focusList";

export function getFocusList() {
  try {
    const val = JSON.parse(localStorage.getItem(FOCUS_KEY));
    return Array.isArray(val) ? val : [];
  }
  catch { return []; }
}

export function saveFocusList(ids) {
  localStorage.setItem(FOCUS_KEY, JSON.stringify(ids));
  window.dispatchEvent(new CustomEvent('focusListChanged'));
}

const SHEET_ID = '1SHSRxATYjYQTuf5zdbBP2Q0KZvQl7kLo6WhSBNTwyFQ';

function statusBadgeClass(status) {
  if (!status) return "badge badge-status-default";
  const s = status.toLowerCase();
  if (s === "resolved") return "badge badge-status-resolved";
  if (s === "ready for testing") return "badge badge-status-testing";
  if (s === "ready for deployment") return "badge badge-status-ready-for-deployment";
  if (s === "internal testing") return "badge badge-status-internal-testing";
  if (s.includes("progress") || s.includes("in process")) return "badge badge-status-progress";
  if (s === "need clarity") return "badge badge-status-discussion";
  if (s === "on hold") return "badge badge-status-hold";
  if (s === "blocked") return "badge badge-status-blocked";
  return "badge badge-status-default";
}

function priorityBadgeClass(priority) {
  if (!priority) return ["badge badge-priority-default", "dot"];
  const p = priority.toLowerCase();
  if (p.includes("high") || p === "critical") return ["badge badge-high", "dot dot-high"];
  if (p === "medium") return ["badge badge-med", "dot dot-med"];
  if (p === "low") return ["badge badge-low", "dot dot-low"];
  return ["badge badge-default", "dot dot-default"];
}

function formatDate(value) {
  if (!value) return "";
  const iso = value.includes("T") ? value : value + "T00:00:00";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function openSheet(url) {
  if (window.electron?.openExternal) {
    window.electron.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
}

function TaskCard({ task, index, projectNames, projectGidMap, sheetIdToTask, onRemove, isDragging, onTooltip, onTooltipMove, onTooltipHide }) {
  const { attributes, listeners, setNodeRef, transform, transition, isSorting } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isSorting ? transition : undefined,
    opacity: isDragging ? 0.2 : 1,
  };

  function sheetUrl(t = task) {
    const gid = projectGidMap[t.project_id];
    if (gid == null || !t.sheet_row) return null;
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${gid}&range=A${t.sheet_row}`;
  }

  function renderNotes(notes) {
    const TOKEN_RE = /(\d+_\d+)/g;
    const parts = [];
    let last = 0;
    let match;
    while ((match = TOKEN_RE.exec(notes)) !== null) {
      if (match.index > last) parts.push(notes.slice(last, match.index));
      const token = match[1];
      const refTask = sheetIdToTask[token];
      parts.push(
        <span
          key={match.index}
          className={`task-ref-token${refTask && sheetUrl(refTask) ? " task-ref-token-linked" : ""}`}
          onMouseEnter={(e) => { if (refTask) onTooltip(refTask, e.clientX, e.clientY); }}
          onMouseMove={(e) => { if (refTask) onTooltipMove(e.clientX, e.clientY); }}
          onMouseLeave={onTooltipHide}
          onClick={() => { if (refTask) { const u = sheetUrl(refTask); if (u) openSheet(u); } }}
        >
          {token}
        </span>
      );
      last = match.index + token.length;
    }
    if (last < notes.length) parts.push(notes.slice(last));
    return parts;
  }

  const url = sheetUrl();

  return (
    <div ref={setNodeRef} style={style} className="fl-item">
      <span className="fl-drag-handle" title="Drag to reorder" {...attributes} {...listeners}>⠿</span>
      <span className="fl-index">{index + 1}</span>

      <div className="task-pill-group fl-task-pill-group">
        <div className="task-pill fl-task-pill">
          {projectNames[task.project_id] && (
            <div className="pill-section s-project">
              <span className="pill-value pill-project-name">{projectNames[task.project_id]}</span>
            </div>
          )}
          <div className="pill-section s-due">
            <span className="pill-value">{formatDate(task.due_date)}</span>
          </div>
          <div className="pill-section s-assign">
            <span className="pill-value">{task.assignee}</span>
          </div>
          <div className="pill-section s-prio">
            <span className="pill-value">
              <span className={priorityBadgeClass(task.priority)[0]}>
                <span className={priorityBadgeClass(task.priority)[1]}></span>
                {task.priority}
              </span>
            </span>
          </div>
          <div className="pill-section s-status">
            <span className="pill-value">
              <span className={statusBadgeClass(task.status)}>{task.status}</span>
            </span>
          </div>
          <div className="pill-section s-desc">
            <span className="pill-value pill-value-wrap">{task.description}</span>
          </div>
          {url && (
            <div className="pill-section s-sheet-link">
              <button
                type="button"
                className="sheet-link"
                title="Open in Google Sheets"
                onClick={() => openSheet(url)}
              >
                ↗
              </button>
            </div>
          )}
        </div>
        {task.notes && (
          <div className="task-notes-strip">
            {renderNotes(task.notes)}
          </div>
        )}
      </div>

      <button
        type="button"
        className="fl-remove-btn"
        title="Remove from Focus List"
        onClick={() => onRemove(task.id)}
      >
        ✕
      </button>
    </div>
  );
}

export default function FocusList() {
  const [tasks, setTasks] = useState([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [projects, setProjects] = useState([]);
  const [focusIds, setFocusIds] = useState(getFocusList);
  const [activeId, setActiveId] = useState(null);
  const [tooltip, setTooltip] = useState({ visible: false, content: null, x: 0, y: 0 });

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  useEffect(() => {
    fetch("/api/tasks").then(r => r.json()).then(data => { setTasks(data); setTasksLoaded(true); }).catch(console.error);
    fetch("/api/projects").then(r => r.json()).then(setProjects).catch(console.error);
  }, []);

  useEffect(() => {
    function syncFocus() { setFocusIds(getFocusList()); }
    function syncTasks(e) { setTasks(e.detail.tasks); setProjects(e.detail.projects); }
    window.addEventListener('focusListChanged', syncFocus);
    window.addEventListener('tasksRefreshed', syncTasks);
    return () => {
      window.removeEventListener('focusListChanged', syncFocus);
      window.removeEventListener('tasksRefreshed', syncTasks);
    };
  }, []);

  const projectNames = Object.fromEntries(projects.map(p => [p.id, p.name]));
  const projectGidMap = Object.fromEntries(projects.map(p => [p.id, p.gid]));
  const sheetIdToTask = Object.fromEntries(tasks.filter(t => t.sheet_id).map(t => [String(t.sheet_id), t]));

  const focusTasks = focusIds
    .map(sid => tasks.find(t => t.sheet_id === sid))
    .filter(Boolean);

  function remove(id) {
    const next = focusIds.filter(fid => fid !== id);
    setFocusIds(next);
    saveFocusList(next);
  }

  function handleDragStart({ active }) {
    setActiveId(active.id);
  }

  function handleDragEnd({ active, over }) {
    setActiveId(null);
    if (!over || active.id === over.id) return;
    const oldIndex = focusTasks.findIndex(t => t.id === active.id);
    const newIndex = focusTasks.findIndex(t => t.id === over.id);
    const reordered = arrayMove(focusTasks, oldIndex, newIndex);
    const newIds = reordered.map(t => t.id);
    saveFocusList(newIds);
    setFocusIds(newIds);
  }

  const activeTask = activeId ? focusTasks.find(t => t.id === activeId) : null;

  return (
    <div className="fl-container">
      <div className="fl-header">
        <h1 className="fl-title">Focus List</h1>
        <span className="fl-count">{focusTasks.length} task{focusTasks.length !== 1 ? "s" : ""}</span>
      </div>

      {!tasksLoaded ? (
        <div className="fl-empty">Loading…</div>
      ) : focusTasks.length === 0 ? (
        <div className="fl-empty">
          No tasks yet. Star (☆) a task from the main view to add it here.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={focusTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
            <div className="fl-list">
              {focusTasks.map((task, index) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  index={index}
                  projectNames={projectNames}
                  projectGidMap={projectGidMap}
                  sheetIdToTask={sheetIdToTask}
                  onRemove={remove}
                  isDragging={task.id === activeId}
                  onTooltip={(content, x, y) => setTooltip({ visible: true, content, x, y })}
                  onTooltipMove={(x, y) => setTooltip(t => ({ ...t, x, y }))}
                  onTooltipHide={() => setTooltip(t => ({ ...t, visible: false }))}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeTask && (
              <div className="fl-item fl-item-overlay">
                <span className="fl-drag-handle">⠿</span>
                <span className="fl-index">{focusTasks.findIndex(t => t.id === activeTask.id) + 1}</span>
                <div className="task-pill fl-task-pill">
                  {projectNames[activeTask.project_id] && (
                    <div className="pill-section s-project">
                      <span className="pill-value pill-project-name">{projectNames[activeTask.project_id]}</span>
                    </div>
                  )}
                  <div className="pill-section s-desc">
                    <span className="pill-value pill-value-wrap">{activeTask.description}</span>
                  </div>
                </div>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {tooltip.visible && tooltip.content && (
        <div
          className="task-ref-tooltip"
          style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
        >
          <div className="tooltip-desc">{tooltip.content.description}</div>
          <div className="tooltip-meta">
            {tooltip.content.assignee && <span>{tooltip.content.assignee}</span>}
            {tooltip.content.status && <span className={statusBadgeClass(tooltip.content.status)}>{tooltip.content.status}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
