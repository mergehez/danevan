import { computed, reactive, ref } from 'vue';

const zIndStack: number[] = [];
const zInd = ref(90);

export function _useOverlaysState() {
    function increaseZIndex() {
        const max = zIndStack.length > 0 ? Math.max(...zIndStack) : 90;
        const newVal = max + 1;
        zInd.value = newVal;
        zIndStack.push(newVal);

        return newVal;
    }

    function decreaseZIndex() {
        const index = zIndStack.indexOf(zInd.value);
        if (index !== -1) {
            zIndStack.splice(index, 1);
            zInd.value = zIndStack.length > 0 ? Math.max(...zIndStack) : 90;
        }

        return zInd.value;
    }

    function toggleZIndex(isOpen: boolean) {
        if (isOpen) {
            increaseZIndex();
        } else {
            decreaseZIndex();
        }
    }

    return reactive({
        zIndex: computed(() => zInd.value),
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
