import { useState, useEffect } from "react";

export default function Tasks() {
  const result = useState([]);
  const tasks = result[0];
  const setTasks = result[1];

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

  function statusBadgeClass(status) {
    if (!status) return "badge badge-status-default";
    const s = status.toLowerCase();
    if (s === "resolved") return "badge badge-status-resolved";
    if (s === "ready for testing") return "badge badge-status-testing";
    if (s.includes("progress") || s.includes("in process")) return "badge badge-status-progress";
    if (s === 'need clarity') return "badge badge-status-discussion";
    if (s === "on hold") return "badge badge-status-hold";
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


  return (
    <div>
      {tasks
        .sort((a, b) => {
          const taskScores = {'Critical': 0, 'Higher': 1, 'High': 2, 'Medium': 3, 'Low': 4};
          let toReturn = taskScores[a.priority] - taskScores[b.priority] == 0 ? new Date(b.due_date) - new Date(a.due_date)  :  taskScores[a.priority] - taskScores[b.priority];
          return toReturn;
        })
        .map((task) => 
          
        {
          return (
            <div key={task.id} className="task-pill">
              <div className="pill-section s-due">
                {/* <span className="pill-label">Due date</span> */}
                <span className="pill-value">{formatDate(task.due_date)}</span>
              </div>
              <div className="pill-section s-assign">
                {/* <span className="pill-label">Assignee</span> */}
                <span className="pill-value">{task.assignee}</span>
              </div>
              <div className="pill-section s-prio">
                {/* <span className="pill-label">Priority</span> */}
                <span className="pill-value">
                  <span className={priorityBadgeClass(task.priority)[0]}>
                    <span className={priorityBadgeClass(task.priority)[1]}></span>{task.priority}
                  </span>
                </span>
              </div>
              <div className="pill-section s-status">
                {/* <span className="pill-label">Status</span> */}
                <span className="pill-value">
                  <span className={statusBadgeClass(task.status)}>{task.status}</span>
                </span>
              </div>
              <div className="pill-section s-desc">
                {/* <span className="pill-label">Task</span> */}
                <span className="pill-value pill-value-wrap">{task.description}</span>
              </div>
            </div>
          );
        })}
    </div>
  );
}
