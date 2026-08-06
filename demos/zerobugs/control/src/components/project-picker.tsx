import type {Project} from '../data/types.ts';
import rocketIcon from '../assets/icons/icon-rocket.svg';
import projectIcon from '../assets/icons/project-box.svg';
import zeroMarkIcon from '../assets/images/mark.svg';
import {Combobox} from './combobox.tsx';

interface Props {
  onChange: (selectedValue: Project) => void;
  projects: readonly Project[];
  selectedProjectName?: string | undefined;
}

function getProjectIcon(project: Project): string {
  if (project.name === 'Zero') {
    return zeroMarkIcon;
  }
  if (project.name === 'Roci') {
    return rocketIcon;
  }
  return projectIcon;
}

export function ProjectPicker({
  projects,
  selectedProjectName,
  onChange,
}: Props) {
  const lowerCaseName = selectedProjectName?.toLocaleLowerCase();
  const selectedProjectIndex = projects.findIndex(
    p => p.lowerCaseName === lowerCaseName,
  );
  let reorderedProjects: readonly Project[] = projects;
  if (selectedProjectIndex !== -1) {
    reorderedProjects = [
      projects[selectedProjectIndex],
      ...projects.slice(0, selectedProjectIndex),
      ...projects.slice(selectedProjectIndex + 1),
    ];
  }
  return projects.length > 1 ? (
    <Combobox<Project>
      editable={false}
      className="project-picker-dropdown"
      items={reorderedProjects.map(p => ({
        text: p.name,
        value: p,
        icon: getProjectIcon(p),
      }))}
      selectedValue={projects.find(p => p.lowerCaseName === lowerCaseName)}
      onChange={onChange}
    />
  ) : (
    <></>
  );
}
