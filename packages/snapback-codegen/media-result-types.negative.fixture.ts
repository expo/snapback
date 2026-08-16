import api, {
  type FunctionResult,
  type GeneratedDataModel,
} from './generated/api';

type ProjectedProfile = FunctionResult<typeof api.listProfiles>[number];

declare const physicalImage: GeneratedDataModel['profiles']['image'];

// The generated handler/storage model is a physical string, while the same
// generated field at the operation-result boundary is a public MediaRef.
const projectedImage: ProjectedProfile['image'] = physicalImage;
void projectedImage;
