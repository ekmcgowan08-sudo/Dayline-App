import AsyncStorage from '@react-native-async-storage/async-storage';
import { alreadyShown, markShown } from '../notificationDedup';

describe('capture-reminder local/server duplicate suppression', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('reports a slot as not-yet-shown before it is marked', async () => {
    expect(await alreadyShown('slot-1')).toBe(false);
  });

  it('reports a slot as shown after markShown', async () => {
    await markShown('slot-1');
    expect(await alreadyShown('slot-1')).toBe(true);
  });

  it('tracks multiple slot ids independently', async () => {
    await markShown('slot-1');
    expect(await alreadyShown('slot-1')).toBe(true);
    expect(await alreadyShown('slot-2')).toBe(false);
  });

  it('bounds the tracked history instead of growing unboundedly', async () => {
    for (let i = 0; i < 150; i++) {
      await markShown(`slot-${i}`);
    }
    // The earliest ids should have been evicted; the most recent must remain.
    expect(await alreadyShown('slot-0')).toBe(false);
    expect(await alreadyShown('slot-149')).toBe(true);
  });
});
