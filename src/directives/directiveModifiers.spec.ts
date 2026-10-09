import { describe, expect, it } from 'vitest';
import { resolveDirectiveModifiers } from './directiveModifiers';

describe('resolveDirectiveModifiers', () => {
    it('counts true-valued keys of a value object as modifiers', () => {
        expect(resolveDirectiveModifiers({ value: { value: 'Open', xs: true, nowrap: true } })).toEqual({ xs: true, nowrap: true });
    });

    it('ignores value keys whose flag is not true', () => {
        expect(resolveDirectiveModifiers({ value: { value: 'Open', xs: 1, sm: 'yes', lg: false, top: null } })).toEqual({});
    });

    it('lets real binding modifiers win over value flags', () => {
        expect(resolveDirectiveModifiers({ value: { xs: true, nowrap: true }, modifiers: { xs: false } })).toEqual({ xs: false, nowrap: true });
    });

    it('returns real modifiers when the value is not an object', () => {
        expect(resolveDirectiveModifiers({ value: 'Open', modifiers: { right: true, end: true } })).toEqual({ right: true, end: true });
    });

    it('ignores a non-object value', () => {
        expect(resolveDirectiveModifiers({ value: 'Open' })).toEqual({});
        expect(resolveDirectiveModifiers({ value: 42 })).toEqual({});
    });

    it('does not turn array indexes into modifiers', () => {
        expect(resolveDirectiveModifiers({ value: ['Rename', 'Delete'] })).toEqual({});
    });

    it('returns no modifiers when value and modifiers are missing', () => {
        expect(resolveDirectiveModifiers({})).toEqual({});
    });
});
