import { useState, useEffect } from "react";

const PROJECT_BUTTONS = [
  { label: "Aqua",  projectId: "28bdccd2-f9c7-4c1f-bf9a-15777d4cc010" },
  { label: "CWP",   projectId: "d6e47b1d-509e-4401-9f62-dd042c4602fe" },
  { label: "Fire",  projectId: "4bf4a22e-2531-4279-9e8c-4dae672284f3" },
];

export default function Tasks() {
  const result = useState([]);
  const tasks = result[0];
  const setTasks = result[1];

  const [projects, setProjects] = useState([]);

  const defaultFilters = { assignee: "", dateFilter: null, status: "", project: "", company: "" };

  function readFiltersFromStorage() {
    try { return { ...defaultFilters, ...JSON.parse(localStorage.getItem('filters')) }; }
    catch { return defaultFilters; }
  }

  const [filters, setFilters] = useState(readFiltersFromStorage);
  const [collapsedProjects, setCollapsedProjects] = useState({});

  useEffect(() => {
    localStorage.setItem('filters', JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    fetch("/api/tasks")
      .then((res) => {
        console.log("res headers : ", res);
        return res.json();
      })
      .then((data) => {
        console.log("data arrived ", data);
        setTasks(data);
      })
      .catch((err) => {
        console.error("Error fetching tasks:", err);
      });
  }, []);

  useEffect(() => {
    fetch("/api/projects")
      .then(res => res.json())
      .then(data => setProjects(data))
      .catch(err => console.error("Error fetching projects:", err));
  }, []);

  function statusBadgeClass(status) {
    if (!status) return "badge badge-status-default";
    const s = status.toLowerCase();
    if (s === "resolved") return "badge badge-status-resolved";
    if (s === "ready for testing") return "badge badge-status-testing";
    if (s === "ready for deployment") return "badge badge-status-ready-for-deployment";
    if (s.includes("progress") || s.includes("in process")) return "badge badge-status-progress";
    if (s === 'need clarity') return "badge badge-status-discussion";
    if (s === "on hold") return "badge badge-status-hold";
    if (s === "blocked") return "badge badge-status-blocked";
    return "badge badge-status-default";
  }

  function priorityBadgeClass(priority) {
    if(!priority) return "badge badge-priority-default";
    const p = priority.toLowerCase();
    if (p.includes("high") || p === "critical") return ["badge badge-high", "dot dot-high"];
    if (p === "medium") return ["badge badge-med", "dot dot-med"];
    if (p === "low") return ["badge badge-low", "dot dot-low"];
    return ["badge badge-default", "dot dot-default"];
  }

  const formatDate = (value) => {
    const iso = value?.includes('T') ? value : value + 'T00:00:00'
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    })
  }

  function isCompleted(status) {
    if (!status) return false;
    const s = status.toLowerCase();
    return s === "resolved" || s === "ready for testing";
  }

  const SHEET_ID = '1SHSRxATYjYQTuf5zdbBP2Q0KZvQl7kLo6WhSBNTwyFQ';
  const projectGidMap = Object.fromEntries(projects.map(p => [p.id, p.gid]));
  const projectNames = Object.fromEntries(projects.map(p => [p.id, p.name]));

  function sheetUrl(task) {
    const gid = projectGidMap[task.project_id];
    if (gid == null || !task.sheet_row) return null;
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${gid}&range=A${task.sheet_row}`;
  }

  function openSheet(url) {
    if (window.electron?.openExternal) {
      window.electron.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  }

  const assignees = [...new Set(tasks.map(t => t.assignee).filter(Boolean))].sort();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const visibleTasks = tasks
    .filter(task => {
      if (!filters.assignee) return true;
      return task.assignee === filters.assignee;
    })
    .filter(task => {
      if (!filters.status) return true;
      if (filters.status === "completed") return isCompleted(task.status);
      if (filters.status === "pending") return !isCompleted(task.status);
    })
    .filter(task => {
      if (!filters.project) return true;
      return task.project_id === filters.project;
    })
    .filter(task => {
      if (!filters.company) return true;
      return task.company_name === filters.company;
    })
    .filter(task => {
      if (!filters.dateFilter) return true;
      const due = new Date(task.due_date?.includes('T') ? task.due_date : task.due_date + 'T00:00:00');
      due.setHours(0, 0, 0, 0);
      if (filters.dateFilter === "today") return due <= today;
      if (filters.dateFilter === "upcoming") return due > today;
    })
    .sort((a, b) => {
      const taskScores = {'Critical': 0, 'Higher': 1, 'High': 2, 'Medium': 3, 'Low': 4};
      let toReturn = taskScores[a.priority] - taskScores[b.priority] == 0 ? new Date(b.due_date) - new Date(a.due_date) : taskScores[a.priority] - taskScores[b.priority];
      return toReturn;
    });

  // Group tasks by project
  const tasksByProject = {};
  for (const task of visibleTasks) {
    const pid = task.project_id;
    if (!tasksByProject[pid]) tasksByProject[pid] = [];
    tasksByProject[pid].push(task);
  }

  const visibleProjectIds = Object.keys(tasksByProject);

  function toggleProject(projectId) {
    setCollapsedProjects(prev => ({ ...prev, [projectId]: !prev[projectId] }));
  }

  function expandAllProjects() {
    const next = {};
    visibleProjectIds.forEach(id => { next[id] = false; });
    setCollapsedProjects(next);
  }

  function collapseAllProjects() {
    const next = {};
    visibleProjectIds.forEach(id => { next[id] = true; });
    setCollapsedProjects(next);
  }

  const [accordionEnabled, setAccordionEnabled] = useState(() => {
    try { return JSON.parse(localStorage.getItem('accordionEnabled') ?? 'true'); }
    catch { return true; }
  });

  useEffect(() => {
    localStorage.setItem('accordionEnabled', JSON.stringify(accordionEnabled));
  }, [accordionEnabled]);

  const [refreshing, setRefreshing] = useState(false);
  const [tooltip, setTooltip] = useState({ visible: false, content: null, x: 0, y: 0 });

  const sheetIdToTask = Object.fromEntries(
    tasks.filter(t => t.sheet_id).map(t => [String(t.sheet_id), t])
  );

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
          onMouseEnter={(e) => {
            if (refTask) setTooltip({ visible: true, content: refTask, x: e.clientX, y: e.clientY });
          }}
          onMouseMove={(e) => {
            if (refTask) setTooltip(t => ({ ...t, x: e.clientX, y: e.clientY }));
          }}
          onMouseLeave={() => setTooltip(t => ({ ...t, visible: false }))}
          onClick={() => {
            if (refTask) {
              const url = sheetUrl(refTask);
              if (url) openSheet(url);
            }
          }}
        >
          {token}
        </span>
      );
      last = match.index + token.length;
    }
    if (last < notes.length) parts.push(notes.slice(last));
    return parts;
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetch('/api/refresh', { method: 'POST' });
    const [tasksRes, projectsRes] = await Promise.all([
      fetch('/api/tasks').then(r => r.json()),
      fetch('/api/projects').then(r => r.json()),
    ]);
    setTasks(tasksRes);
    setProjects(projectsRes);
    setRefreshing(false);
  }

  function toggleDateFilter(value) {
    setFilters(f => ({ ...f, dateFilter: f.dateFilter === value ? null : value }));
  }

  function renderTask(task, showProject = false) {
    return (
      <div key={task.id} id={`task-${task.id}`} className="task-pill-group">
        <div className="task-pill">
          {showProject && projectNames[task.project_id] && (
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
                <span className={priorityBadgeClass(task.priority)[1]}></span>{task.priority}
              </span>
            </span>
          </div>
          <div className="pill-section s-status">
            <span className="pill-value">
              <span className={statusBadgeClass(task.status)}>{task.status}</span>
            </span>
          </div>
          {task.sheet_id && (
            <div className="pill-section s-sheet-id">
              <span className="pill-value pill-sheet-id">{task.sheet_id}</span>
            </div>
          )}
          <div className="pill-section s-desc">
            <span className="pill-value pill-value-wrap">{task.description}</span>
          </div>
          {sheetUrl(task) && (
            <div className="pill-section s-sheet-link">
              <button
                type="button"
                className="sheet-link"
                title="Open in Google Sheets"
                onClick={() => openSheet(sheetUrl(task))}
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
    );
  }

  return (
    <div>
      <div className="filter-bar">
        <select
          className="filter-select"
          value={filters.project}
          onChange={e => setFilters(f => ({ ...f, project: e.target.value }))}
        >
          <option value="">All projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <select
          className="filter-select"
          value={filters.assignee}
          onChange={e => setFilters(f => ({ ...f, assignee: e.target.value }))}
        >
          <option value="">All assignees</option>
          {assignees.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        <div className="btn-group">
          {PROJECT_BUTTONS.map(btn => (
            <button
              key={btn.label}
              className={`filter-btn${filters.project === btn.projectId ? " filter-btn-active" : ""}`}
              onClick={() => setFilters(f => ({ ...f, project: f.project === btn.projectId ? "" : btn.projectId }))}
            >{btn.label}</button>
          ))}
        </div>

        <div className="btn-group">
          <button
            className={`filter-btn${filters.company === "NAWSC" ? " filter-btn-active" : ""}`}
            onClick={() => setFilters(f => ({ ...f, company: f.company === "NAWSC" ? "" : "NAWSC" }))}
          >NAWSC</button>
          <button
            className={`filter-btn${filters.company === "CloudMentor" ? " filter-btn-active" : ""}`}
            onClick={() => setFilters(f => ({ ...f, company: f.company === "CloudMentor" ? "" : "CloudMentor" }))}
          >CloudMentor</button>
        </div>

        <div className="btn-group">
          <button
            className={`filter-btn${filters.status === "pending" ? " filter-btn-active" : ""}`}
            onClick={() => setFilters(f => ({ ...f, status: f.status === "pending" ? "" : "pending" }))}
          >Pending</button>
          <button
            className={`filter-btn${filters.status === "completed" ? " filter-btn-active" : ""}`}
            onClick={() => setFilters(f => ({ ...f, status: f.status === "completed" ? "" : "completed" }))}
          >Completed</button>
        </div>

        <div className="btn-group">
          <button
            className={`filter-btn${filters.dateFilter === "today" ? " filter-btn-active" : ""}`}
            onClick={() => toggleDateFilter("today")}
          >Today</button>
          <button
            className={`filter-btn${filters.dateFilter === "upcoming" ? " filter-btn-active" : ""}`}
            onClick={() => toggleDateFilter("upcoming")}
          >Upcoming</button>
        </div>

        <button
          className={`filter-btn${accordionEnabled ? " filter-btn-active" : ""}`}
          onClick={() => setAccordionEnabled(v => !v)}
        >Accordion</button>

        <button className="filter-btn refresh-btn" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? "Refreshing..." : "Refresh"} ↻
        </button>
      </div>

      {accordionEnabled && visibleProjectIds.length > 1 && (
        <div className="accordion-controls">
          <button className="filter-btn" onClick={expandAllProjects}>Expand All</button>
          <button className="filter-btn" onClick={collapseAllProjects}>Collapse All</button>
        </div>
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

      {accordionEnabled
        ? visibleProjectIds.map(projectId => {
            const isCollapsed = !!collapsedProjects[projectId];
            const name = projectNames[projectId] || projectId;
            return (
              <div key={projectId} className="project-accordion">
                <button
                  type="button"
                  className="project-accordion-header"
                  onClick={() => toggleProject(projectId)}
                >
                  <span className={`accordion-chevron ${isCollapsed ? "collapsed" : ""}`}>
                    {isCollapsed ? "▶" : "▼"}
                  </span>
                  {name}
                  <span className="accordion-count">{tasksByProject[projectId].length}</span>
                </button>
                {!isCollapsed && (
                  <div className="accordion-body">
                    {tasksByProject[projectId].map(t => renderTask(t))}
                  </div>
                )}
              </div>
            );
          })
        : visibleTasks.map(t => renderTask(t, true))
      }
    </div>
  );
}
