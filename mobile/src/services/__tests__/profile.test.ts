import { uploadAvatar } from '../profile';

const mockUploadLocalFile = jest.fn(
  async (_bucket: string, _path: string, _localUri: string, _contentType: string, _upsert: boolean) => ({ error: null })
);

jest.mock('../../lib/storageUpload', () => ({
  uploadLocalFile: (...args: [string, string, string, string, boolean]) => mockUploadLocalFile(...args),
}));

const mockGetPublicUrl = jest.fn((path: string) => ({
  data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/avatars/${path}` },
}));

jest.mock('../../lib/supabase', () => ({
  supabase: { storage: { from: () => ({ getPublicUrl: (path: string) => mockGetPublicUrl(path) }) } },
}));

const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('uploadAvatar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Regression test: uploadAvatar used to name every upload
  // `avatar-${Date.now()}.<ext>`, so despite passing upsert:true, each
  // profile-photo change left the previous avatar object orphaned in
  // storage forever — one leaked file per change, indefinitely, for
  // every user who ever updates their photo.
  it('uploads every avatar to the same stable path so upsert actually overwrites, not a growing set of files', async () => {
    await uploadAvatar(USER_ID, 'file:///first-photo.jpg');
    await uploadAvatar(USER_ID, 'file:///second-photo.png');

    expect(mockUploadLocalFile).toHaveBeenCalledTimes(2);
    const [, firstPath] = mockUploadLocalFile.mock.calls[0]!;
    const [, secondPath] = mockUploadLocalFile.mock.calls[1]!;
    expect(firstPath).toBe(`${USER_ID}/avatar`);
    expect(secondPath).toBe(`${USER_ID}/avatar`);
    expect(firstPath).toBe(secondPath);

    // upsert must stay true, or the second upload would fail outright
    // once the first has already created the object at that path.
    expect(mockUploadLocalFile.mock.calls[0]![4]).toBe(true);
    expect(mockUploadLocalFile.mock.calls[1]![4]).toBe(true);
  });

  it('still returns a fresh (cache-busted) URL on every upload despite the storage path staying the same', async () => {
    // Mock Date.now so the two calls deterministically get different
    // cache-buster values, rather than depending on real time advancing
    // between two fast, mostly-synchronous awaits (which could land in
    // the same millisecond and make this test flaky).
    const dateSpy = jest.spyOn(Date, 'now');
    dateSpy.mockReturnValueOnce(1000).mockReturnValueOnce(2000);

    const first = await uploadAvatar(USER_ID, 'file:///first-photo.jpg');
    const second = await uploadAvatar(USER_ID, 'file:///second-photo.jpg');
    dateSpy.mockRestore();

    expect('url' in first && 'url' in second).toBe(true);
    if ('url' in first && 'url' in second) {
      expect(first.url).toContain(`avatars/${USER_ID}/avatar`);
      expect(second.url).toContain(`avatars/${USER_ID}/avatar`);
      expect(first.url).not.toBe(second.url);
    }
  });
});
