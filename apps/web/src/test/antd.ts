import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * Thao tác với ô chọn antd (Select) trong test.
 * UiProvider test=true tắt danh sách ảo nên mọi mục đều render với role="option".
 */

function openDropdown(): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>('.ant-select-dropdown'));
  return all.filter((el) => !el.classList.contains('ant-select-dropdown-hidden')).at(-1) ?? null;
}

/** Mở danh sách của một ô chọn (ô lấy bằng getByLabelText hoặc getByRole('combobox')). */
export async function openSelect(control: HTMLElement) {
  if (!openDropdown()) await userEvent.click(control);
  await waitFor(() => {
    if (!openDropdown()) throw new Error('Danh sách chọn chưa mở.');
  });
}

/** Mở ô chọn và chờ mục có tên tương ứng. */
export async function findOption(control: HTMLElement, name: string | RegExp) {
  await openSelect(control);
  return screen.findByRole('option', { name });
}

/** Chọn một mục trong ô chọn theo tên hiển thị. */
export async function chooseOption(control: HTMLElement, name: string | RegExp) {
  await userEvent.click(await findOption(control, name));
}

/** Chữ của mục đang chọn trong ô (antd 6 đặt nhãn ở title của .ant-select-content). */
export function selectedText(control: HTMLElement): string | null {
  const content = control.closest('.ant-select')?.querySelector('.ant-select-content');
  return content?.getAttribute('title') ?? content?.textContent ?? null;
}
