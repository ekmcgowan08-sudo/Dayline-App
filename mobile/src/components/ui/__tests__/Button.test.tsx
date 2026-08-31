import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button } from '../Button';

describe('Button', () => {
  it('calls onPress when tapped', async () => {
    const onPress = jest.fn();
    await render(<Button label="Capture a moment" onPress={onPress} />);
    fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress while loading', async () => {
    const onPress = jest.fn();
    await render(<Button label="Save" onPress={onPress} loading />);
    fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not call onPress while disabled', async () => {
    const onPress = jest.fn();
    await render(<Button label="Continue" onPress={onPress} disabled />);
    fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('exposes disabled/busy accessibility state while loading', async () => {
    await render(<Button label="Save" onPress={() => {}} loading />);
    const button = screen.getByRole('button');
    expect(button.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
  });

  it('renders the label text when not loading', async () => {
    await render(<Button label="Join" onPress={() => {}} />);
    expect(screen.getByText('Join')).toBeTruthy();
  });
});
