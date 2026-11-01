import React from "react";
import { Category } from "../../types";
import { useContentEditor } from "./useContentEditor";
import { CategorySidebar } from "./CategorySidebar";
import { SubcategoryPanel } from "./SubcategoryPanel";

interface ContentTabProps {
  categories: Category[];
  onUpdateCategories: (categories: Category[]) => void;
  faviconApi?: string;
  defaultCategoryId?: string;
  onSetDefault: (id: string | null) => void;
}

export const ContentTab: React.FC<ContentTabProps> = ({
  categories,
  onUpdateCategories,
  faviconApi,
  defaultCategoryId,
  onSetDefault,
}) => {
  const { state, actions } = useContentEditor(categories, onUpdateCategories, faviconApi);

  return (
    <div className="flex w-full h-[calc(100vh-12rem)] animate-fade-in surface-elevated border border-default rounded-2xl overflow-hidden shadow-sm">
      <CategorySidebar
        categories={categories}
        state={state}
        actions={actions}
        defaultCategoryId={defaultCategoryId}
        onSetDefault={onSetDefault}
      />
      <SubcategoryPanel categories={categories} state={state} actions={actions} />
    </div>
  );
};
