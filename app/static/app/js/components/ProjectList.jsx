import React from "react";
import $ from "jquery";
import "../css/ProjectList.scss";

import ProjectListItem from "./ProjectListItem";
import TaskList from "./TaskList"; // Import the TaskList here
import Paginator from "./Paginator";
import ErrorMessage from "./ErrorMessage";
import { _, interpolate } from "../classes/gettext";
import PropTypes from "prop-types";
import Utils from "../classes/Utils";
import EditProjectDialog from "./EditProjectDialog";

class ProjectList extends React.Component {
  static propTypes = {
    history: PropTypes.object.isRequired,
  };

  constructor(props) {
    super(props);

    this.state = {
      loading: true,
      refreshing: false,
      error: "",
      projects: [],
      selectedProject: null, // Track the selected project
      searchedText: "",
    };

    this.PROJECTS_PER_PAGE = 10;

    this.handleAddProject = this.handleAddProject.bind(this);
    this.addNewProject = this.addNewProject.bind(this);
    this.handleDelete = this.handleDelete.bind(this);
    this.handleProjectClick = this.handleProjectClick.bind(this); // Bind the new method
    this.handleBackButtonClick = this.handleBackButtonClick.bind(this); // Bind the back button method
    this.refresh = this.refresh.bind(this); // Refresh method needs to be bound
    this.handleSearchedText = this.handleSearchedText.bind(this); // Handle
  }

  componentDidMount() {
    this.refresh();
  }

  refresh() {
    this.setState({ refreshing: true });

    this.serverRequest = $.getJSON(this.props.source, (json) => {
      if (json.results) {
        this.setState({
          projects: json.results,
          loading: false,
        });
      } else {
        this.setState({
          error: interpolate(_("Invalid JSON response: %(error)s"), {
            error: JSON.stringify(json),
          }),
          loading: false,
        });
      }
    })
      .fail((jqXHR, textStatus, errorThrown) => {
        this.setState({
          error: interpolate(_("Could not load projects list: %(error)s"), {
            error: textStatus,
          }),
          loading: false,
        });
      })
      .always(() => {
        this.setState({ refreshing: false });
      });
  }

  handleSearchedText(text) {
    this.setState({ searchedText: text });
  }
  handleProjectClick(projectId) {
    // When a project is clicked, set the selected project
    const selectedProject = this.state.projects.find(
      (project) => project.id === projectId
    );
    this.setState({ selectedProject });
  }

  handleBackButtonClick() {
    // When the back button is clicked, deselect the project
    this.setState({ selectedProject: null });
  }

  handleDelete(projectId) {
    let projects = this.state.projects.filter((p) => p.id !== projectId);
    this.setState({ projects: projects });
  }

  handleAddProject() {
    this.projectDialog.show();
  }

  addNewProject(project) {
    if (!project.name)
      return new $.Deferred().reject(_("Name field is required"));

    return $.ajax({
      url: `/api/projects/`,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({
        name: project.name,
        description: project.descr,
        tags: project.tags,
      }),
    }).done(() => {
      this.projectList.refresh();
    });
  }
  render() {
    const { selectedProject } = this.state;

    if (this.state.loading) {
      return (
        <div className="project-list text-center">
          <i className="fa fa-sync fa-spin fa-2x fa-fw"></i>
        </div>
      );
    }

    if (selectedProject) {
      // Render the TaskList when a project is selected
      return (
        <div className="task-list-page">
          <button onClick={this.handleBackButtonClick} className="btnn">
            <i class="far fa-arrow-alt-circle-left"></i>
          </button>
          <TaskList
            source={`/api/projects/${selectedProject.id}/tasks/?ordering=-created_at`}
            project={this.state.selectedProject}
            onDelete={() => this.handleDelete(selectedProject.id)}
            onTaskMoved={this.refresh}
            hasPermission={(perm) => selectedProject.permissions.includes(perm)}
            onTagsChanged={() => {}}
            onTagClicked={() => {}}
            history={this.props.history}
          />
        </div>
      );
    } else {
      // Render the ProjectList if no project is selected
      return (
        <div className="project-list">
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              justifyContent: "space-between",
              width: "100%",
              padding: "15px 15px",
            }}
          >
            <div>
              <h3>
                {this.state.searchedText.length > 0
                  ? this.state.searchedText
                  : "All Projects"}
              </h3>
              <h4 style={{ color: "#013372" }}>
                {this.state.projects.length} projects
              </h4>
            </div>
            <div className="text-right add-button">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={this.handleAddProject}
              >
                <i className="glyphicon glyphicon-plus"></i>
                {_("Add Project")}
              </button>
            </div>

            <EditProjectDialog
              saveAction={this.addNewProject}
              ref={(domNode) => {
                this.projectDialog = domNode;
              }}
            />
          </div>
          <ErrorMessage bind={[this, "error"]} />
          <Paginator
            {...this.state.pagination}
            handleSearched={this.handleSearchedText}
            handlerefresh={() => this.refresh()}
            {...this.props}
          >
            <ul
              key="1"
              className={
                "list-group project-list " +
                (this.state.refreshing ? "refreshing" : "")
              }
            >
              {this.state.projects.map((p) => (
                <ProjectListItem
                  key={p.id}
                  data={p}
                  onDelete={this.handleDelete}
                  onClick={() => this.handleProjectClick(p.id)} // Add the onClick handler
                  onTaskMoved={this.refresh}
                  onProjectDuplicated={this.refresh}
                  history={this.props.history}
                />
              ))}
            </ul>
          </Paginator>
        </div>
      );
    }
  }
}

export default ProjectList;
