"use client";

import type { ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * 縦並びのリストをドラッグ&ドロップで並べ替えるための共通コンポーネント。
 *
 * スマホのタッチ操作を前提にしているため:
 * - つまむ場所を専用の「⠿ ハンドル」に限定する(カード全体をドラッグ対象にしない)
 * - ハンドルに touch-action: none を当てて、指の動きをドラッグに使う
 * - TouchSensor は 100ms の長押しで起動。リストの外を触れば今までどおりスクロールできる
 * - MouseSensor / KeyboardSensor も併用(PC・キーボード操作でも並べ替えできる)
 */

type DragHandleUi = {
  /** カードの好きな場所に置くドラッグ用ハンドル */
  dragHandle: ReactNode;
  isDragging: boolean;
};

function DragHandle({
  attributes,
  listeners,
  label,
}: {
  attributes: Record<string, unknown>;
  listeners: Record<string, unknown> | undefined;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      // touch-action: none がないと、指の動きがページスクロールに取られてドラッグできない
      style={{ touchAction: "none" }}
      className="flex h-10 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-gray-400 active:bg-gray-100 active:text-gray-600"
      {...attributes}
      {...listeners}
    >
      <span aria-hidden className="text-lg leading-none">
        ⠿
      </span>
    </button>
  );
}

function SortableRow<T extends { id: string }>({
  item,
  handleLabel,
  children,
}: {
  item: T;
  handleLabel: string;
  children: (item: T, ui: DragHandleUi) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={isDragging ? "relative opacity-90 shadow-lg" : "relative"}
    >
      {children(item, {
        isDragging,
        dragHandle: (
          <DragHandle
            attributes={attributes as unknown as Record<string, unknown>}
            listeners={listeners as unknown as Record<string, unknown>}
            label={handleLabel}
          />
        ),
      })}
    </li>
  );
}

export default function SortableList<T extends { id: string }>({
  items,
  onReorder,
  itemLabel,
  className,
  children,
}: {
  items: T[];
  /** 並べ替え後の配列(新しい順序)を受け取る */
  onReorder: (items: T[]) => void;
  /** スクリーンリーダー用に「何を」並べ替えているかを伝える(例: 種目) */
  itemLabel: string;
  className?: string;
  children: (item: T, ui: DragHandleUi) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 100, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const position = (id: string) => items.findIndex((i) => i.id === id) + 1;

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `${itemLabel}の並べ替えを開始しました(${position(
        String(active.id)
      )}番目)。`,
    onDragOver: ({ over }) =>
      over
        ? `${position(String(over.id))}番目に移動します。`
        : undefined,
    onDragEnd: ({ over }) =>
      over
        ? `${position(String(over.id))}番目に移動しました。`
        : `${itemLabel}の並べ替えをやめました。`,
    onDragCancel: () => `${itemLabel}の並べ替えをやめました。`,
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === active.id);
    const to = items.findIndex((i) => i.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(items, from, to));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      accessibility={{ announcements }}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map((i) => i.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className={className}>
          {items.map((item) => (
            <SortableRow
              key={item.id}
              item={item}
              handleLabel={`${itemLabel}を並べ替える`}
            >
              {children}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
