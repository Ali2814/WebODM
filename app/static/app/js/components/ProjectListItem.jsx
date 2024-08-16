import "../css/ProjectListItem.scss";
import React, { Component } from "react";
import PropTypes from "prop-types";
import update from "immutability-helper";
import $ from "jquery";

import NewTaskPanel from "./NewTaskPanel";
import ImportTaskPanel from "./ImportTaskPanel";
import UploadProgressBar from "./UploadProgressBar";
import ErrorMessage from "./ErrorMessage";
import EditProjectDialog from "./EditProjectDialog";
import HistoryNav from "../classes/HistoryNav";
import Tags from "../classes/Tags";
import Dropzone from "../vendor/dropzone";
import csrf from "../django/csrf";
import exifr from "../vendor/exifr";
import ResizeModes from "../classes/ResizeModes"; // Ensure ResizeModes is imported

class ProjectListItem extends Component {
  static propTypes = {
    history: PropTypes.object.isRequired,
    data: PropTypes.object.isRequired,
    onDelete: PropTypes.func,
    onTaskMoved: PropTypes.func,
    onProjectDuplicated: PropTypes.func,
    onClick: PropTypes.func.isRequired,
  };

  constructor(props) {
    super(props);

    this.historyNav = new HistoryNav(props.history);
    this.state = {
      showTaskList: this.historyNav.isValueInQSList(
        "project_task_open",
        props.data.id
      ),
      upload: this.getDefaultUploadState(),
      error: "",
      data: props.data,
      refreshing: false,
      importing: false,
      buttons: [],
      sortKey: "-created_at",
      filterTags: [],
      selectedTags: [],
      filterText: "",
      showDropdown: false,
    };

    this.sortItems = [
      { key: "created_at", label: "Created on" },
      { key: "name", label: "Name" },
      { key: "tags", label: "Tags" },
    ];
  }

  componentDidMount() {
    Dropzone.autoDiscover = false;

    if (this.hasPermission("add")) {
      this.initializeDropzone();
    }

    PluginsAPI.Dashboard.triggerAddNewTaskButton(
      { projectId: this.state.data.id, onNewTaskAdded: this.newTaskAdded },
      (button) => {
        if (button) {
          this.setState(
            update(this.state, {
              buttons: { $push: [button] },
            })
          );
        }
      }
    );
  }

  componentDidUpdate(prevProps, prevState) {
    if (
      prevState.filterText !== this.state.filterText ||
      prevState.selectedTags.length !== this.state.selectedTags.length
    ) {
      if (this.taskList) {
        this.taskList.applyFilter(
          this.state.filterText,
          this.state.selectedTags
        );
      }
    }
  }

  componentWillUnmount() {
    if (this.deleteProjectRequest) this.deleteProjectRequest.abort();
    if (this.refreshRequest) this.refreshRequest.abort();
  }

  getDefaultUploadState() {
    return {
      uploading: false,
      editing: false,
      error: "",
      progress: 0,
      files: [],
      totalCount: 0,
      uploadedCount: 0,
      totalBytes: 0,
      totalBytesSent: 0,
      lastUpdated: 0,
    };
  }

  initializeDropzone() {
    this.dz = new Dropzone(this.dropzone, {
      paramName: "images",
      url: "TO_BE_CHANGED",
      parallelUploads: 6,
      uploadMultiple: false,
      acceptedFiles: "image/*,text/plain,.las,.laz,video/*,.srt",
      autoProcessQueue: false,
      createImageThumbnails: false,
      clickable: this.uploadButton,
      maxFilesize: 131072,
      chunkSize: 2147483647,
      timeout: 2147483647,
      headers: {
        [csrf.header]: csrf.token,
      },
    });

    this.dz
      .on("addedfiles", this.handleFilesAdded)
      .on("uploadprogress", this.handleUploadProgress)
      .on("complete", this.handleUploadComplete)
      .on("queuecomplete", this.handleQueueComplete)
      .on("reset", this.resetUploadState)
      .on("dragenter", () => {
        if (!this.state.upload.editing) {
          this.resetUploadState();
        }
      });
  }

  handleFilesAdded = (files) => {
    // Ensure files is an array
    files = Array.isArray(files) ? files : Array.from(files);

    let totalBytes = 0;
    files.forEach((file) => {
      totalBytes += file.size;
      file.deltaBytesSent = 0;
      file.trackedBytesSent = 0;
      file.retries = 0;
    });

    this.setUploadState({
      editing: true,
      totalCount: this.state.upload.totalCount + files.length,
      files,
      totalBytes: this.state.upload.totalBytes + totalBytes,
    });
  };

  handleUploadProgress = (file, progress, bytesSent) => {
    const now = Date.now();

    if (bytesSent > file.size) bytesSent = file.size;

    if (progress === 100 || now - this.state.upload.lastUpdated > 500) {
      const deltaBytesSent = bytesSent - file.deltaBytesSent;
      file.trackedBytesSent += deltaBytesSent;

      const totalBytesSent = this.state.upload.totalBytesSent + deltaBytesSent;
      const progress = (totalBytesSent / this.state.upload.totalBytes) * 100;

      this.setUploadState({
        progress,
        totalBytesSent,
        lastUpdated: now,
      });

      file.deltaBytesSent = bytesSent;
    }
  };

  handleUploadComplete = (file) => {
    const retry = () => {
      const MAX_RETRIES = 20;

      if (file.retries < MAX_RETRIES) {
        const totalBytesSent =
          this.state.upload.totalBytesSent - file.trackedBytesSent;
        const progress = (totalBytesSent / this.state.upload.totalBytes) * 100;

        this.setUploadState({
          progress,
          totalBytesSent,
        });

        file.status = Dropzone.QUEUED;
        file.deltaBytesSent = 0;
        file.trackedBytesSent = 0;
        file.retries++;
        setTimeout(() => {
          this.dz.processQueue();
        }, 5000 * file.retries);
      } else {
        throw new Error(
          `Cannot upload ${file.name}, exceeded max retries (${MAX_RETRIES})`
        );
      }
    };

    try {
      if (file.status === "error") {
        if (file.size / 1024 / 1024 > this.dz.options.maxFilesize) {
          this.setUploadState({
            totalCount: this.state.upload.totalCount - 1,
            totalBytes: this.state.upload.totalBytes - file.size,
          });
          throw new Error(
            `Cannot upload ${file.name}, file is too large! Default MaxFileSize is ${this.dz.options.maxFilesize} MB!`
          );
        }
        retry();
      } else {
        const response = JSON.parse(file.xhr.response);
        if (
          response.success &&
          response.uploaded &&
          response.uploaded[file.name] === file.size
        ) {
          let totalBytesSent = this.state.upload.totalBytesSent + file.size;
          if (file.trackedBytesSent) totalBytesSent -= file.trackedBytesSent;

          const progress =
            (totalBytesSent / this.state.upload.totalBytes) * 100;

          this.setUploadState({
            progress,
            totalBytesSent,
            uploadedCount: this.state.upload.uploadedCount + 1,
          });

          this.dz.processQueue();
        } else {
          retry();
        }
      }
    } catch (e) {
      if (this.manuallyCanceled) {
        this.setUploadState({ uploading: false });
      } else {
        this.setUploadState({ error: `${e.message}`, uploading: false });
      }

      if (this.dz.files.length) this.dz.cancelUpload();
    }
  };

  handleQueueComplete = () => {
    const remainingFilesCount =
      this.state.upload.totalCount - this.state.upload.uploadedCount;
    if (remainingFilesCount === 0 && this.state.upload.uploadedCount > 0) {
      this.setUploadState({ uploading: false });

      $.ajax({
        url: `/api/projects/${this.state.data.id}/tasks/${this.dz._taskInfo.id}/commit/`,
        contentType: "application/json",
        dataType: "json",
        type: "POST",
      })
        .done((task) => {
          if (task && task.id) {
            this.newTaskAdded();
          } else {
            this.setUploadState({
              error: `Cannot create new task. Invalid response from server: ${JSON.stringify(
                task
              )}`,
            });
          }
        })
        .fail(() => {
          this.setUploadState({
            error: "Cannot create new task. Please try again later.",
          });
        });
    } else if (this.dz.getQueuedFiles() === 0) {
      this.setUploadState({
        uploading: false,
        error: `${remainingFilesCount} files cannot be uploaded. As a reminder, only images (.jpg, .tif, .png) and GCP files (.txt) can be uploaded. Try again.`,
      });
    }
  };

  setUploadState(props) {
    this.setState(
      update(this.state, {
        upload: {
          $merge: props,
        },
      })
    );
  }

  resetUploadState = () => {
    this.setUploadState(this.getDefaultUploadState());
  };

  refresh = () => {
    this.setState({ refreshing: true });

    this.refreshRequest = $.getJSON(`/api/projects/${this.state.data.id}/`)
      .done((json) => {
        this.setState({ data: json });
      })
      .fail((_, __, e) => {
        this.setState({ error: e.message });
      })
      .always(() => {
        this.setState({ refreshing: false });
      });
  };

  hasPermission(perm) {
    return this.state.data.permissions.includes(perm);
  }

  newTaskAdded = () => {
    this.setState({ importing: false });

    if (this.state.showTaskList) {
      this.taskList.refresh();
    } else {
      this.setState({ showTaskList: true });
    }
    this.resetUploadState();
    this.refresh();
  };

  handleTaskSaved = (taskInfo) => {
    this.dz._taskInfo = taskInfo;

    this.setUploadState({ uploading: true, editing: false });

    const formData = {
      name: taskInfo.name,
      options: taskInfo.options,
      processing_node: taskInfo.selectedNode.id,
      auto_processing_node: taskInfo.selectedNode.key === "auto",
      partial: true,
    };

    if (taskInfo.resizeMode === ResizeModes.YES) {
      formData.resize_to = taskInfo.resizeSize;
    }

    $.ajax({
      url: `/api/projects/${this.state.data.id}/tasks/`,
      contentType: "application/json",
      data: JSON.stringify(formData),
      dataType: "json",
      type: "POST",
    })
      .done((task) => {
        if (task && task.id) {
          this.dz._taskInfo.id = task.id;
          this.dz.options.url = `/api/projects/${this.state.data.id}/tasks/${task.id}/upload/`;
          this.dz.processQueue();
        } else {
          this.setState({
            error: `Cannot create new task. Invalid response from server: ${JSON.stringify(
              task
            )}`,
          });
          this.handleTaskCanceled();
        }
      })
      .fail(() => {
        this.setState({
          error: "Cannot create new task. Please try again later.",
        });
        this.handleTaskCanceled();
      });
  };

  handleTaskCanceled = () => {
    this.dz.removeAllFiles(true);
    this.resetUploadState();
  };

  handleDelete = () => {
    return $.ajax({
      url: `/api/projects/${this.state.data.id}/`,
      type: "DELETE",
    }).done(() => {
      if (this.props.onDelete) this.props.onDelete(this.state.data.id);
    });
  };

  handleEditProject = () => {
    this.editProjectDialog.show();
  };

  updateProject = (project) => {
    return $.ajax({
      url: `/api/projects/${this.state.data.id}/edit/`,
      contentType: "application/json",
      data: JSON.stringify({
        name: project.name,
        description: project.descr,
        tags: project.tags,
        permissions: project.permissions,
      }),
      dataType: "json",
      type: "POST",
    }).done(() => {
      this.refresh();
    });
  };

  viewMap = () => {
    location.href = `/map/project/${this.state.data.id}/`;
  };

  toggleDropdown = () => {
    this.setState({ showDropdown: !this.state.showDropdown });
  };

  handleImportTask = () => {
    this.setState({ importing: true });
  };

  handleCancelImportTask = () => {
    this.setState({ importing: false });
  };
  handleTaskTitleHint = async (hasGPSCallback) => {
    try {
      if (this.state.upload.files.length > 0) {
        let f = this.state.upload.files.find((file) =>
          file.type.includes("image")
        );
        if (!f) throw new Error("No image file found");

        const options = {
          exif: [0x9003],
          gps: [0x0001, 0x0002, 0x0003, 0x0004],
        };

        const exif = await exifr.parse(f, options);
        if (!exif || !exif.latitude || !exif.longitude) {
          console.warn("No GPS data found in image");
          return null; // Or return a default name
        }

        if (hasGPSCallback) hasGPSCallback();

        let dateTime = exif.DateTimeOriginal?.toLocaleDateString();

        if (!dateTime) {
          dateTime =
            f.lastModifiedDate?.toLocaleDateString() ||
            new Date(f.lastModified).toLocaleDateString();
        }

        const response = await $.ajax({
          url: `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${exif.latitude}&lon=${exif.longitude}`,
          contentType: "application/json",
        });

        if (response.name) return `${response.name} - ${dateTime}`;
        if (response.address?.road)
          return `${response.address.road} - ${dateTime}`;

        throw new Error("Invalid response");
      }
    } catch (error) {
      console.error(error);
      return null; // Fallback in case of an error
    }
  };

  render() {
    const { refreshing, data } = this.state;
    const { onClick } = this.props;

    const numTasks = data.tasks.length;
    const canEdit = this.hasPermission("change");
    const userTags = Tags.userTags(data.tags);
    let deleteWarning =
      "All tasks, images and models associated with this project will be permanently deleted. Are you sure you want to continue?";
    if (!data.owned)
      deleteWarning =
        "This project was shared with you. It will not be deleted, but simply hidden from your dashboard. Continue?";

    return (
      <li
        className={`project-list-item list-group-item ${
          refreshing ? "refreshing" : ""
        }`}
        ref={(domNode) => (this.dropzone = domNode)}
      >
        {canEdit && (
          <EditProjectDialog
            ref={(domNode) => {
              this.editProjectDialog = domNode;
            }}
            title="Edit Project"
            saveLabel="Save Changes"
            savingLabel="Saving changes..."
            saveIcon="far fa-edit"
            showDuplicate={true}
            onDuplicated={this.props.onProjectDuplicated}
            projectName={data.name}
            projectDescr={data.description}
            projectId={data.id}
            projectTags={data.tags}
            deleteWarning={deleteWarning}
            saveAction={this.updateProject}
            showPermissions={this.hasPermission("change")}
            deleteAction={
              this.hasPermission("delete") ? this.handleDelete : undefined
            }
          />
        )}

        <div className="project-card">
          <div className="image-container">
            <a href="javascript:void(0);" onClick={onClick}>
              <img
                src="https://i.postimg.cc/8cg74Q4T/ivan-bandura-b-Nm-VYEd5-VJI-unsplash-1.jpg"
                alt="Project Image"
              />
            </a>
            <button
              type="button"
              className="upload-button btn btn-primary btn-sm"
              onClick={this.handleUpload}
              ref={(domNode) => (this.uploadButton = domNode)}
            >
              <i className="glyphicon glyphicon-upload upload-icon"></i>
              <span className="hidden-xs">Select Images and GCP</span>
            </button>
          </div>
          <div className="card-details">
            <a href="javascript:void(0);" onClick={onClick}>
              <h3 className="project-name">
                {data.name}
                {userTags.map((t, i) => (
                  <div key={i} className="tag-badge small-badge">
                    {t}
                  </div>
                ))}
              </h3>
              <p className="survey-count">{numTasks} Tasks</p>
            </a>
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                justifyContent: "space-between",
                width: "100%",
                alignItems: "center",
              }}
            >
              <div>
                {numTasks > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <i class="fa fa-map" style={{ color: "#F7941E" }}></i>
                    <button
                      className="view-map-button"
                      style={{ width: "max-content", marginLeft: "5px" }}
                      onClick={this.viewMap}
                    >
                      View Map
                    </button>
                  </div>
                )}
              </div>
              <div
                className="col-xs-5 col-sm-6 col-md-4 col-lg-3 actions"
                style={{ width: "100%" }}
              >
                {/* {taskActions.length > 0 ? (
                  <div
                    className="btn-group"
                    style={{
                      position: "absolute",
                      bottom: "20px",
                      right: "10px",
                    }}
                  >
                    <button
                      disabled={disabled || actionLoading}
                      className="btn task-actions btn-secondary btn-xs dropdown-toggle"
                      type="button"
                      data-toggle="dropdown"
                      aria-haspopup="true"
                      aria-expanded="false"
                    >
                      <i className={"fa " + taskActionsIcon}></i>
                    </button>
                    <ul className="dropdown-menu dropdown-menu-right">
                      {taskActions}
                    </ul>
                  </div>
                ) : (
                  ""
                )} */}
              </div>
              <div className="dropdown">
                <button
                  // disabled={disabled || actionLoading}
                  className="btn task-actions btn-secondary btn-xs dropdown-toggle"
                  type="button"
                  data-toggle="dropdown"
                  aria-haspopup="true"
                  aria-expanded="false"
                >
                  <i class="fa fa-ellipsis-v" style={{ color: "black" }}></i>
                  {/* <span className="dropdown-icon">⋮</span> */}
                </button>
                <ul className="dropdown-menu dropdown-menu-right">
                  {canEdit && (
                    <>
                      <li key="edit">
                        <a
                          href="javascript:void(0)"
                          onClick={(e) => {
                            e.preventDefault();
                            this.handleEditProject();
                          }}
                        >
                          <i
                            className="glyphicon glyphicon-pencil"
                            style={{ color: "#F7941E" }}
                          ></i>
                          Edit
                        </a>
                      </li>
                    </>
                  )}
                  {this.hasPermission("add") && (
                    <li>
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          this.handleImportTask();
                        }}
                      >
                        <i
                          class="fa fa-file-import"
                          style={{ color: "#F7941E" }}
                        ></i>
                        Import
                      </a>
                    </li>
                  )}
                  {(canEdit || !data.owned) && (
                    <li>
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          this.handleDelete();
                        }}
                      >
                        <i
                          className="fa fa-trash"
                          style={{ color: "#F7941E" }}
                        ></i>
                        Delete
                      </a>
                    </li>
                  )}
                </ul>
                {/* )} */}
              </div>
            </div>
          </div>
        </div>

        <ErrorMessage bind={[this, "error"]} />

        {this.state.upload.uploading && (
          <UploadProgressBar {...this.state.upload} />
        )}

        {this.state.upload.error && (
          <div
            className="alert alert-warning alert-dismissible"
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              /* background-color: lightblue; */
              padding: "20px",
              borderRadius: "8px",
              zIndex: "999999",
            }}
          >
            <button
              type="button"
              className="close"
              title="Close"
              onClick={() => this.closeUploadError}
            >
              <span aria-hidden="true">&times;</span>
            </button>
            {this.state.upload.error}
          </div>
        )}

        {this.state.upload.editing && (
          <div
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              /* background-color: lightblue; */
              padding: "20px",
              borderRadius: "8px",
              zIndex: "999999",
            }}
          >
            <NewTaskPanel
              onSave={this.handleTaskSaved}
              onCancel={this.handleTaskCanceled}
              suggestedTaskName={this.handleTaskTitleHint}
              filesCount={this.state.upload.totalCount}
              showResize={true}
              getFiles={() => this.state.upload.files}
            />
          </div>
        )}

        {this.state.importing && (
          <div
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              /* background-color: lightblue; */
              padding: "20px",
              borderRadius: "8px",
              zIndex: "999999",
            }}
          >
            <ImportTaskPanel
              onImported={this.newTaskAdded}
              onCancel={this.handleCancelImportTask}
              projectId={this.state.data.id}
            />
          </div>
        )}
      </li>
    );
  }
}

export default ProjectListItem;
