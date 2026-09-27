import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';
import { ref, Transition, watch } from 'vue';
import { useOverlaysState } from '../../directives/useOverlaysState';
import { toast } from '../utils/useToast';
import { Alert } from './Alert.tsx';
import { IconButton } from './IconButton.tsx';

type Props = {};

export const AppSuccessToast = component(
    (_: Props) => {
        const overlayState = useOverlaysState();
        const toastZIndex = ref(90);

        watch(
            () => toast.message,
            (message) => {
                toastZIndex.value = message ? overlayState.claimZIndex() : overlayState.releaseZIndex(toastZIndex.value);
            }
        );

        return () => (
            <Transition
                enterActiveClass="transition duration-200 ease-out"
                enterFromClass="translate-y-2 opacity-0"
                enterToClass="translate-y-0 opacity-100"
                leaveActiveClass="transition duration-200 ease-in"
                leaveFromClass="translate-y-0 opacity-100"
                leaveToClass="translate-y-2 opacity-0"
            >
                {toast.message ? (
                    <Alert severity={toast.severity} class="pointer-events-auto fixed right-4 top-4 max-w-sm w-auto" style={{ zIndex: toastZIndex.value }}>
                        <div class="flex items-start gap-2">
                            {toast.severity === 'success' ? (
                                <span class="icon icon-[mdi--check-circle] text-2xl text-green-500 shrink-0" />
                            ) : toast.severity === 'danger' ? (
                                <span class="icon icon-[mdi--close-circle] text-2xl text-red-500 shrink-0" />
                            ) : toast.severity === 'warning' ? (
                                <span class="icon icon-[mdi--alert-circle] text-2xl text-yellow-500 shrink-0" />
                            ) : null}
                            <p class="flex-1">{toast.message}</p>
                            <IconButton
                                severity="raised"
                                v-tooltip={{ value: 'Dismiss notification', xs: true, nowrap: true }}
                                icon="icon-[mdi--close] text-xl text-green-700"
                                onClick={() => toast.dismissToast()}
                            />
                        </div>
                    </Alert>
                ) : null}
            </Transition>
        );
    },
    { name: 'AppSuccessToast', props: ensureAllTsxProps<Props>()([]) }
);

export default AppSuccessToast;
