import { computed, reactive, ref } from 'vue';

const zIndStack: number[] = [];
const defaultZIndex = 1000;
const zInd = ref(defaultZIndex);

export function _useOverlaysState() {
    function increaseZIndex() {
        const max = zIndStack.length > 0 ? Math.max(...zIndStack) : defaultZIndex;
        const newVal = max + 1;
        zInd.value = newVal;
        zIndStack.push(newVal);

        console.log('Increased z-index, new value:', zInd.value);
        return newVal;
    }

    function decreaseZIndex(value = zInd.value) {
        const index = zIndStack.indexOf(value);
        if (index !== -1) {
            zIndStack.splice(index, 1);
            zInd.value = zIndStack.length > 0 ? Math.max(...zIndStack) : defaultZIndex;

            console.warn('Decreased z-index, new value:', zInd.value);
        }

        return zInd.value;
    }

    function claimZIndex() {
        return increaseZIndex();
    }

    function releaseZIndex(value: number | undefined) {
        if (value == null) {
            return zInd.value;
        }

        return decreaseZIndex(value);
    }

    function toggleZIndex(isOpen: boolean, value?: number) {
        if (isOpen) {
            return claimZIndex();
        } else {
            return releaseZIndex(value);
        }
    }

    return reactive({
        zIndex: computed(() => zInd.value),
        claimZIndex: claimZIndex,
        releaseZIndex: releaseZIndex,
        increaseZIndex: increaseZIndex,
        decreaseZIndex: decreaseZIndex,
        toggleZIndex: toggleZIndex,
    });
}

let _state: ReturnType<typeof _useOverlaysState> | null = null;

export function useOverlaysState() {
    if (!_state) {
        _state = _useOverlaysState();
    }
    return _state;
}
