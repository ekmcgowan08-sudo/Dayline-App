import { useUploadQueueStore } from '../../state/upload-queue-store';
import { uploadLocalFile } from '../../lib/storageUpload';
import { processUploadQueue } from '../clips';

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 1024 })),
  deleteAsync: jest.fn(async () => undefined),
}));

jest.mock('../../lib/storageUpload', () => ({
  uploadLocalFile: jest.fn(async () => ({ error: null })),
}));

const mockMaybeSingle = jest.fn(async () => ({ data: null }));
const mockEq2 = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockEq1 = jest.fn(() => ({ eq: mockEq2 }));
const mockSelect = jest.fn(() => ({ eq: mockEq1 }));
const mockUpsert = jest.fn(async () => ({ error: null }));
const mockFrom = jest.fn((_table: string) => ({ select: mockSelect, upsert: mockUpsert }));

jest.mock('../../lib/supabase', () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function seed(userId: string, clientCaptureId: string) {
  useUploadQueueStore.getState().enqueue({
    clientCaptureId,
    userId,
    localUri: `file:///${clientCaptureId}.mp4`,
    durationMs: 5000,
    capturedAt: new Date().toISOString(),
  });
}

beforeEach(() => {
  useUploadQueueStore.setState({ items: [] });
  jest.clearAllMocks();
});

describe('processUploadQueue', () => {
  // Regression test: this upload queue is device-global (persisted to
  // AsyncStorage, not namespaced per account), so on a shared/borrowed
  // device a clip captured by one user can still be queued when a
  // different user signs in on the same device. processUploadQueue must
  // only ever touch the CURRENTLY signed-in user's own items — otherwise
  // another user's private, not-yet-uploaded video gets silently
  // uploaded and attributed to whoever is signed in now.
  it("only uploads items belonging to the requesting user, leaving another user's queued items untouched", async () => {
    seed(USER_A, 'clip-a');
    seed(USER_B, 'clip-b');

    await processUploadQueue(USER_A);

    expect(uploadLocalFile).toHaveBeenCalledTimes(1);
    expect(uploadLocalFile).toHaveBeenCalledWith('clips', expect.stringContaining(`${USER_A}/`), 'file:///clip-a.mp4', 'video/mp4', true);

    const items = useUploadQueueStore.getState().items;
    const itemA = items.find((i) => i.clientCaptureId === 'clip-a')!;
    const itemB = items.find((i) => i.clientCaptureId === 'clip-b')!;
    expect(itemA.status).toBe('done');
    expect(itemB.status).toBe('queued');
    expect(itemB.userId).toBe(USER_B);
  });

  it("processing as the second user only then uploads that user's own leftover item", async () => {
    seed(USER_A, 'clip-a');
    seed(USER_B, 'clip-b');

    await processUploadQueue(USER_A);
    jest.clearAllMocks();
    await processUploadQueue(USER_B);

    expect(uploadLocalFile).toHaveBeenCalledTimes(1);
    expect(uploadLocalFile).toHaveBeenCalledWith('clips', expect.stringContaining(`${USER_B}/`), 'file:///clip-b.mp4', 'video/mp4', true);

    const items = useUploadQueueStore.getState().items;
    expect(items.find((i) => i.clientCaptureId === 'clip-b')!.status).toBe('done');
  });
});
