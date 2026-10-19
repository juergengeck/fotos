import {describe, expect, it, vi} from 'vitest';
import {createElement} from 'react';
vi.mock('react-native', () => ({View: 'View', Pressable: 'Pressable', Text: 'Text', ActivityIndicator: 'ActivityIndicator'}));
import {GlueLoginField} from './GlueLoginField';

describe('Expo identity field Glue button', () => {
  it('renders an accessible Glue action beside the input and invokes its handler', () => {
    const onPress = vi.fn();
    const input = createElement('TextInput', {testID: 'login-input'});
    const row = GlueLoginField({children: input, busy: false, disabled: false, onPress});
    expect(row.props.style.flexDirection).toBe('row');
    const [field, button] = row.props.children;
    expect(field.props.children).toBe(input);
    expect(button.props.accessibilityLabel).toBe('Sign in with glue.one');
    expect(button.props.disabled).toBe(false);
    button.props.onPress(); expect(onPress).toHaveBeenCalledTimes(1);
  });
  it('shows running state and disables the adjacent action during login', () => {
    const row = GlueLoginField({children: null, busy: true, disabled: true, onPress: vi.fn()});
    const button = row.props.children[1];
    expect(button.props.accessibilityState).toEqual({busy: true, disabled: true});
    expect(button.props.disabled).toBe(true);
    expect(button.props.children.type).toBe('ActivityIndicator');
  });
});
